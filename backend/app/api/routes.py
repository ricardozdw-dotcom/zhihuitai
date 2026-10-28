import json
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import now
from app.config import get_settings
from app.db import SessionLocal, engine, get_db
from app.models import (
    AuditEvent,
    ChatMessageRow,
    Conversation,
    Document,
    DocumentMetadata,
    ImportTask,
    KnowledgeBase,
    ProviderProfile,
    QueryLog,
    Role,
)
from app.rag.pipeline import hits_to_documents, stream_answer
from app.rag.retrieve import retrieve
from app.schemas import (
    ChatIn,
    ChunkOut,
    DocumentOut,
    ImportTaskOut,
    KnowledgeBaseCreate,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
    MetadataIn,
    ProviderIn,
    ProviderOut,
    QueryLogOut,
    RetrievalHit,
    RetrievalIn,
    RoleOut,
    UploadOut,
)
from app.serialize import (
    chunk_out,
    document_out,
    import_task_out,
    knowledge_base_out,
    provider_out,
    query_log_out,
    role_out,
)
from app.services.blob import get_blob_store
from app.services.ingest import fingerprint, process_document
from app.models import Chunk

router = APIRouter(prefix="/api")
MAX_BYTES = 32 * 1024 * 1024


def _kb_or_404(session: Session, knowledge_base_id: uuid.UUID) -> KnowledgeBase:
    item = session.get(KnowledgeBase, knowledge_base_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到知识库")
    return item


def _parse_uuid(value: str, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} 不是有效 ID") from exc


@router.get("/health", summary="健康检查", tags=["系统"])
def health() -> JSONResponse:
    settings = get_settings()
    database = "error"
    vector = None
    detail = ""
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
            vector = connection.exec_driver_sql(
                "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
            ).scalar()
        database = "ok" if vector else "missing-pgvector"
    except Exception as exc:
        detail = str(exc)[:200]
    redis_status = "skipped"
    try:
        import redis

        redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.4).ping()
        redis_status = "ok"
    except Exception:
        redis_status = "unavailable"
    ok = database == "ok"
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "status": "ok" if ok else "error",
            "database": database,
            "vector": vector,
            "redis": redis_status,
            "ingestInline": settings.ingest_inline,
            "llm": "configured" if settings.llm_configured else "mock",
            "embedding": "configured" if settings.embedding_configured else "deterministic-hash",
            "detail": detail,
        },
    )


@router.get("/roles", response_model=list[RoleOut], summary="角色与权限声明", tags=["系统"])
def list_roles(session: Session = Depends(get_db)) -> list[RoleOut]:
    rows = session.scalars(select(Role).order_by(Role.id)).all()
    return [role_out(item) for item in rows]


@router.get("/providers", response_model=list[ProviderOut], summary="供应商配置存根", tags=["系统"])
def list_providers(session: Session = Depends(get_db)) -> list[ProviderOut]:
    rows = session.scalars(select(ProviderProfile).order_by(ProviderProfile.provider)).all()
    return [provider_out(item) for item in rows]


@router.post("/providers", response_model=ProviderOut, summary="登记供应商配置", tags=["系统"])
def create_provider(body: ProviderIn, session: Session = Depends(get_db)) -> ProviderOut:
    item = ProviderProfile(
        provider=body.provider,
        capability=body.capability,
        name=body.name,
        model=body.model,
        endpoint=body.endpoint,
        status="untested",
        dimension=1024 if body.capability == "Embedding" else None,
    )
    session.add(item)
    session.flush()
    return provider_out(item)


@router.get("/logs/queries", response_model=list[QueryLogOut], summary="查询日志", tags=["系统"])
def list_query_logs(session: Session = Depends(get_db)) -> list[QueryLogOut]:
    rows = session.scalars(select(QueryLog).order_by(QueryLog.created_at.desc()).limit(100)).all()
    return [query_log_out(item) for item in rows]


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseOut], summary="知识库列表", tags=["知识库"])
def list_knowledge_bases(session: Session = Depends(get_db)) -> list[KnowledgeBaseOut]:
    rows = session.scalars(select(KnowledgeBase).order_by(KnowledgeBase.updated_at.desc())).all()
    return [knowledge_base_out(session, item) for item in rows]


@router.post("/knowledge-bases", response_model=KnowledgeBaseOut, summary="创建知识库", tags=["知识库"])
def create_knowledge_base(body: KnowledgeBaseCreate, session: Session = Depends(get_db)) -> KnowledgeBaseOut:
    settings = get_settings()
    model = body.embedding_model or settings.embedding_label
    if not settings.embedding_configured:
        model = settings.embedding_label
    item = KnowledgeBase(
        name=body.name.strip(),
        description=body.description.strip() or "尚未添加知识库说明。",
        owner=body.owner.strip() or "未指定负责人",
        tags=body.tags or ["新建"],
        status="ready",
        embedding_model=model,
        embedding_dimension=settings.embedding_dim,
        updated_at=now(),
    )
    session.add(item)
    session.flush()
    return knowledge_base_out(session, item)


@router.get("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseOut, summary="知识库详情", tags=["知识库"])
def get_knowledge_base(knowledge_base_id: uuid.UUID, session: Session = Depends(get_db)) -> KnowledgeBaseOut:
    return knowledge_base_out(session, _kb_or_404(session, knowledge_base_id))


@router.patch("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseOut, summary="更新知识库", tags=["知识库"])
def update_knowledge_base(
    knowledge_base_id: uuid.UUID,
    body: KnowledgeBaseUpdate,
    session: Session = Depends(get_db),
) -> KnowledgeBaseOut:
    item = _kb_or_404(session, knowledge_base_id)
    if body.status and body.status not in {"ready", "processing", "warning", "disabled"}:
        raise HTTPException(status_code=422, detail="不支持的知识库状态")
    for field in ("name", "description", "owner", "status", "tags"):
        value = getattr(body, field)
        if value is not None:
            setattr(item, field, value)
    item.updated_at = now()
    session.flush()
    return knowledge_base_out(session, item)


@router.delete("/knowledge-bases/{knowledge_base_id}", summary="删除知识库", tags=["知识库"])
def delete_knowledge_base(knowledge_base_id: uuid.UUID, session: Session = Depends(get_db)) -> dict:
    item = _kb_or_404(session, knowledge_base_id)
    documents = session.scalars(select(Document).where(Document.knowledge_base_id == item.id)).all()
    store = get_blob_store()
    for document in documents:
        store.delete(document.storage_key)
    session.add(
        AuditEvent(
            action="knowledge_base.delete",
            entity_type="knowledge_base",
            entity_id=str(item.id),
            detail=item.name,
        )
    )
    session.delete(item)
    return {"deleted": True}


@router.get(
    "/knowledge-bases/{knowledge_base_id}/documents",
    response_model=list[DocumentOut],
    summary="文档列表",
    tags=["文档"],
)
def list_documents(knowledge_base_id: uuid.UUID, session: Session = Depends(get_db)) -> list[DocumentOut]:
    _kb_or_404(session, knowledge_base_id)
    rows = session.scalars(
        select(Document)
        .where(Document.knowledge_base_id == knowledge_base_id)
        .order_by(Document.created_at.desc())
    ).all()
    return [document_out(session, item) for item in rows]


@router.post(
    "/knowledge-bases/{knowledge_base_id}/documents",
    response_model=UploadOut,
    summary="上传文档并建立索引",
    tags=["文档"],
)
async def upload_document(
    knowledge_base_id: uuid.UUID,
    file: UploadFile = File(...),
    metadata: str | None = Form(default=None),
    session: Session = Depends(get_db),
) -> UploadOut:
    knowledge_base = _kb_or_404(session, knowledge_base_id)
    if knowledge_base.status == "disabled":
        raise HTTPException(status_code=400, detail="已停用的知识库不能导入")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件是空的")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 32 MB")
    parsed_metadata: MetadataIn | None = None
    if metadata:
        try:
            parsed_metadata = MetadataIn.model_validate_json(metadata)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="元数据不是合法 JSON") from exc
    digest = fingerprint(data)
    duplicate = session.scalar(
        select(Document).where(Document.knowledge_base_id == knowledge_base.id, Document.sha256 == digest)
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="同一知识库已有内容相同的文件")
    file_name = Path(file.filename or "未命名.txt").name
    suffix = file_name.rsplit(".", 1)[-1].upper() if "." in file_name else "FILE"
    document = Document(
        knowledge_base_id=knowledge_base.id,
        name=file_name,
        format=suffix,
        size_bytes=len(data),
        status="processing",
        parser="",
        sha256=digest,
        storage_key="pending",
        updated_at=now(),
    )
    session.add(document)
    session.flush()
    document.storage_key = f"{knowledge_base.id}/{document.id}/{file_name}"
    get_blob_store().put(document.storage_key, data)
    if parsed_metadata is not None:
        session.add(
            DocumentMetadata(
                document_id=document.id,
                time=parsed_metadata.time,
                version=parsed_metadata.version,
                subject=parsed_metadata.subject,
                owner=parsed_metadata.owner,
                keywords=parsed_metadata.keywords,
                questions=parsed_metadata.questions,
            )
        )
    task = ImportTask(
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        file_name=file_name,
        stage="上传",
        status="processing",
        progress=5,
        updated_at=now(),
    )
    session.add(task)
    knowledge_base.status = "processing"
    knowledge_base.updated_at = now()
    session.commit()
    settings = get_settings()
    if settings.ingest_inline:
        process_document(str(document.id))
    else:
        from app.workers.tasks import ingest_document_task

        ingest_document_task.delay(str(document.id))
    session.refresh(document)
    session.refresh(task)
    return UploadOut(document=document_out(session, document), task=import_task_out(session, task))


@router.get("/documents/{document_id}", response_model=DocumentOut, summary="文档详情", tags=["文档"])
def get_document(document_id: uuid.UUID, session: Session = Depends(get_db)) -> DocumentOut:
    item = session.get(Document, document_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到文档")
    return document_out(session, item)


@router.patch("/documents/{document_id}/metadata", response_model=DocumentOut, summary="更新文档元数据", tags=["文档"])
def update_metadata(document_id: uuid.UUID, body: MetadataIn, session: Session = Depends(get_db)) -> DocumentOut:
    item = session.get(Document, document_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到文档")
    if item.meta is None:
        session.add(
            DocumentMetadata(
                document_id=item.id,
                time=body.time,
                version=body.version,
                subject=body.subject,
                owner=body.owner,
                keywords=body.keywords,
                questions=body.questions,
            )
        )
    else:
        item.meta.time = body.time
        item.meta.version = body.version
        item.meta.subject = body.subject
        item.meta.owner = body.owner
        item.meta.keywords = body.keywords
        item.meta.questions = body.questions
    item.updated_at = now()
    session.flush()
    return document_out(session, item)


@router.delete("/documents/{document_id}", summary="删除文档", tags=["文档"])
def delete_document(document_id: uuid.UUID, session: Session = Depends(get_db)) -> dict:
    item = session.get(Document, document_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到文档")
    get_blob_store().delete(item.storage_key)
    session.add(
        AuditEvent(
            action="document.delete",
            entity_type="document",
            entity_id=str(item.id),
            detail=item.name,
        )
    )
    knowledge_base_id = item.knowledge_base_id
    session.delete(item)
    session.flush()
    knowledge_base = session.get(KnowledgeBase, knowledge_base_id)
    if knowledge_base and knowledge_base.status != "disabled":
        knowledge_base.updated_at = now()
    return {"deleted": True}


@router.get("/documents/{document_id}/chunks", response_model=list[ChunkOut], summary="文档分块", tags=["文档"])
def list_document_chunks(document_id: uuid.UUID, session: Session = Depends(get_db)) -> list[ChunkOut]:
    item = session.get(Document, document_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到文档")
    rows = session.scalars(select(Chunk).where(Chunk.document_id == item.id).order_by(Chunk.position)).all()
    return [chunk_out(row) for row in rows]


@router.get(
    "/knowledge-bases/{knowledge_base_id}/chunks",
    response_model=list[ChunkOut],
    summary="知识库分块",
    tags=["文档"],
)
def list_knowledge_chunks(knowledge_base_id: uuid.UUID, session: Session = Depends(get_db)) -> list[ChunkOut]:
    _kb_or_404(session, knowledge_base_id)
    rows = session.scalars(
        select(Chunk).where(Chunk.knowledge_base_id == knowledge_base_id).order_by(Chunk.position)
    ).all()
    return [chunk_out(row) for row in rows]


@router.get("/import-tasks/{task_id}", response_model=ImportTaskOut, summary="导入任务状态", tags=["导入"])
def get_import_task(task_id: uuid.UUID, session: Session = Depends(get_db)) -> ImportTaskOut:
    item = session.get(ImportTask, task_id)
    if item is None:
        raise HTTPException(status_code=404, detail="未找到导入任务")
    return import_task_out(session, item)


@router.post("/import-tasks/{task_id}/retry", response_model=ImportTaskOut, summary="重试导入", tags=["导入"])
def retry_import_task(task_id: uuid.UUID, session: Session = Depends(get_db)) -> ImportTaskOut:
    item = session.get(ImportTask, task_id)
    if item is None or item.document_id is None:
        raise HTTPException(status_code=404, detail="未找到可重试的导入任务")
    item.status = "processing"
    item.stage = "上传"
    item.progress = 5
    item.error = None
    item.updated_at = now()
    document = session.get(Document, item.document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="原文件已删除")
    document.status = "processing"
    document.error_reason = None
    session.commit()
    if get_settings().ingest_inline:
        process_document(str(document.id))
    else:
        from app.workers.tasks import ingest_document_task

        ingest_document_task.delay(str(document.id))
    session.refresh(item)
    return import_task_out(session, item)


@router.post(
    "/knowledge-bases/{knowledge_base_id}/retrieval",
    response_model=list[RetrievalHit],
    summary="检索测试",
    tags=["问答"],
)
def retrieval_test(
    knowledge_base_id: uuid.UUID,
    body: RetrievalIn,
    session: Session = Depends(get_db),
) -> list[RetrievalHit]:
    _kb_or_404(session, knowledge_base_id)
    if body.mode not in {"hybrid", "dense", "keyword"}:
        raise HTTPException(status_code=422, detail="mode 只能是 hybrid、dense 或 keyword")
    hits, _elapsed = retrieve(session, [knowledge_base_id], body.query, top_k=body.top_k, mode=body.mode)
    return [
        RetrievalHit(
            id=hit.chunk_id,
            title=hit.title,
            content=hit.content,
            source=hit.source,
            locator=hit.locator,
            dense_score=hit.dense_score,
            keyword_score=hit.keyword_score,
            rerank_score=hit.rerank_score,
            sufficient=hit.sufficient,
        )
        for hit in hits
    ]
