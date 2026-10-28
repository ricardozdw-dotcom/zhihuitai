from __future__ import annotations

import hashlib
import re
import uuid

from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.clock import now
from app.config import get_settings
from app.db import SessionLocal
from app.models import Chunk, Document, DocumentMetadata, ImportTask, KnowledgeBase
from app.services.blob import get_blob_store
from app.services.embeddings import embed_texts
from app.services.metadata_extract import extract_metadata
from app.services.parse import ParseError, parse_document
from app.services.observability import TraceRecorder, execution_source

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=700,
    chunk_overlap=80,
    separators=["\n\n", "\n", "。", "；", "，", " ", ""],
)


def _stage(session: Session, task: ImportTask, stage: str, progress: int, status: str = "processing", error: str | None = None) -> None:
    task.stage = stage
    task.progress = progress
    task.status = status
    task.error = error
    task.updated_at = now()
    session.commit()


def _refresh_kb(session: Session, knowledge_base: KnowledgeBase) -> None:
    if knowledge_base.status == "disabled":
        knowledge_base.updated_at = now()
        return
    session.flush()
    statuses = session.scalars(
        select(Document.status).where(Document.knowledge_base_id == knowledge_base.id)
    ).all()
    if any(item == "processing" for item in statuses):
        knowledge_base.status = "processing"
    elif any(item == "failed" for item in statuses):
        knowledge_base.status = "warning"
    else:
        knowledge_base.status = "ready"
    knowledge_base.updated_at = now()


def _chunks_from_text(text: str, file_name: str) -> list[tuple[str, str, str]]:
    raw_parts = _splitter.split_text(text)
    chunks: list[tuple[str, str, str]] = []
    page = 1
    for index, part in enumerate(raw_parts, start=1):
        page_match = re.search(r"\f(\d+)", part)
        if page_match:
            page = int(page_match.group(1))
        body = re.sub(r"\f\d+\n?", "", part).strip()
        if not body:
            continue
        first = next((line.strip("# ").strip() for line in body.splitlines() if line.strip()), body)
        title = first[:40]
        locator = f"第 {page} 页 · 片段 {index}" if "\f" in text else f"片段 {index}"
        chunks.append((title, body, locator))
    if not chunks and text.strip():
        chunks.append((file_name, text.strip()[:700], "片段 1"))
    return chunks


def process_document(document_id: str) -> None:
    settings = get_settings()
    with SessionLocal() as session:
        document = session.get(Document, uuid.UUID(document_id))
        if document is None:
            return
        task = session.scalar(
            select(ImportTask)
            .where(ImportTask.document_id == document.id)
            .order_by(ImportTask.created_at.desc())
        )
        knowledge_base = session.get(KnowledgeBase, document.knowledge_base_id)
        if task is None or knowledge_base is None:
            return
        trace = TraceRecorder(kind="build", name=f"构建 · {document.name}", input=document.name, knowledge=knowledge_base.name)
        active = None

        def stage(name, progress, input, function=None, explanation=""):
            nonlocal active
            if active and active["status"] == "running":
                trace.end(active, {"stage": active["name"], "completed": True})
            _stage(session, task, name, progress)
            extra = {"executionSource": execution_source(function, explanation)} if function else {}
            active = trace.add(f"stage-{progress}", name, "build", input, **extra)

        try:
            stage("解析", 20, {"documentId": document_id, "file": document.name, "bytes": document.size_bytes}, parse_document, "读取文件的可提取文本层；不支持或缺少云 OCR 的文件明确失败，不伪造解析成功。")
            data = get_blob_store().get(document.storage_key)
            text, parser, _marked = parse_document(document.name, data)
            document.parser = parser
            document.error_reason = None
            session.commit()
            trace.end(active, {"parser": parser, "text": text})

            stage("元数据", 40, {"fileName": document.name, "text": text}, extract_metadata, "从实际文件名与正文提取文档索引元数据；若已有人工作业元数据则保留。")
            if document.meta is None:
                extracted = extract_metadata(
                    file_name=document.name,
                    content=text,
                    file_format=document.format,
                    knowledge_base_name=knowledge_base.name,
                    owner=knowledge_base.owner,
                )
                if settings.llm_configured:
                    extracted = _llm_metadata(text, document.name, extracted, settings)
                session.add(
                    DocumentMetadata(
                        document_id=document.id,
                        time=extracted.time,
                        version=extracted.version,
                        subject=extracted.subject,
                        owner=extracted.owner,
                        keywords=extracted.keywords,
                        questions=extracted.questions,
                    )
                )
                session.commit()
            trace.end(active, {"metadata": {"time": document.meta.time, "version": document.meta.version, "subject": document.meta.subject, "owner": document.meta.owner, "keywords": document.meta.keywords, "questions": document.meta.questions} if document.meta else None})

            stage("分块", 60, {"text": text, "chunkSize": 700, "overlap": 80}, _chunks_from_text, "使用 LangChain RecursiveCharacterTextSplitter 切分实际正文，记录标题、内容、定位；目前后端使用 700 字符 / 80 重叠。")
            pieces = _chunks_from_text(text, document.name)
            if not pieces:
                raise ParseError("解析结果为空，未写入索引")
            trace.end(active, {"chunks": [{"title": p[0], "content": p[1], "locator": p[2]} for p in pieces]})
            session.execute(delete(Chunk).where(Chunk.document_id == document.id))
            session.commit()

            stage("Embedding 与索引", 80, {"count": len(pieces), "model": settings.embedding_label}, embed_texts, "调用已配置 Embedding API 或明确标记的本地哈希向量，并把向量与正文写入 pgvector。未采集供应商 usage 时用量和费用保持未知。")
            vectors = embed_texts([piece[1] for piece in pieces], settings)
            for position, ((title, content, locator), vector) in enumerate(zip(pieces, vectors, strict=True)):
                session.add(
                    Chunk(
                        knowledge_base_id=document.knowledge_base_id,
                        document_id=document.id,
                        title=title,
                        content=content,
                        source=document.name,
                        locator=locator,
                        enabled=True,
                        tokens=max(1, len(content) // 2),
                        position=position,
                        embedding=vector,
                    )
                )
            document.status = "ready"
            document.updated_at = now()
            _refresh_kb(session, knowledge_base)
            _stage(session, task, "完成", 100, status="success")
            trace.end(active, {"indexedChunks": len(pieces), "documentId": document_id}, provider="openai-compatible" if settings.embedding_configured else "local", model=settings.embedding_model if settings.embedding_configured else "deterministic-hash", cost=None if settings.embedding_configured else 0, currency="CNY", tokenSource="unknown" if settings.embedding_configured else "none")
            trace.finish(f"{document.name} 已写入 {len(pieces)} 个分块，可检索。")
        except Exception as exc:
            session.rollback()
            secret = settings.embedding_api_key or settings.llm_api_key
            message = str(exc) or exc.__class__.__name__
            if secret:
                message = message.replace(secret, "***")
            message = message[:500]
            if active and active["status"] == "running":
                trace.end(active, {"message": message}, status="failed", error="INGEST_STAGE_FAILED")
            trace.finish(message, status="failed", error="INGEST_STAGE_FAILED")
            document = session.get(Document, uuid.UUID(document_id))
            task = session.scalar(
                select(ImportTask)
                .where(ImportTask.document_id == uuid.UUID(document_id))
                .order_by(ImportTask.created_at.desc())
            )
            knowledge_base = session.get(KnowledgeBase, document.knowledge_base_id) if document else None
            if document is not None:
                document.status = "failed"
                document.error_reason = message
                document.updated_at = now()
            if knowledge_base is not None:
                _refresh_kb(session, knowledge_base)
            if task is not None:
                _stage(session, task, task.stage or "解析", task.progress, status="failed", error=message)
            else:
                session.commit()


def _llm_metadata(text, file_name, fallback, settings):
    """配置了 LLM 时尝试 JSON 抽取，失败则退回启发式结果。"""
    import json

    from langchain_core.prompts import ChatPromptTemplate
    from langchain_openai import ChatOpenAI

    from app.services.metadata_extract import ExtractedMetadata

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "你从企业文档中抽取索引元数据，只输出 JSON，键为 time, version, subject, owner, keywords, questions。"
                "time 用 YYYY-MM-DD，keywords 和 questions 是字符串数组。",
            ),
            ("human", "文件名：{name}\n\n正文：\n{body}"),
        ]
    )
    llm = ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        temperature=0,
    )
    try:
        raw = (prompt | llm).invoke({"name": file_name, "body": text[:4000]}).content
        match = re.search(r"\{.*\}", str(raw), re.S)
        if not match:
            return fallback
        payload = json.loads(match.group(0))
        return ExtractedMetadata(
            time=str(payload.get("time") or fallback.time),
            version=str(payload.get("version") or fallback.version),
            subject=str(payload.get("subject") or fallback.subject),
            owner=str(payload.get("owner") or fallback.owner),
            keywords=[str(item) for item in payload.get("keywords") or fallback.keywords][:6],
            questions=[str(item) for item in payload.get("questions") or fallback.questions][:4],
        )
    except Exception:
        return fallback


def fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
