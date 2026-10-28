from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import display_time, human_size
from app.models import Chunk, Document, ImportTask, KnowledgeBase, ProviderProfile, QueryLog, Role
from app.schemas import (
    ChunkOut,
    DocumentOut,
    ImportTaskOut,
    KnowledgeBaseOut,
    MetadataOut,
    ProviderOut,
    QueryLogOut,
    RoleOut,
)


def empty_metadata() -> MetadataOut:
    return MetadataOut(time="", version="", subject="", owner="", keywords=[], questions=[])


def knowledge_base_out(session: Session, item: KnowledgeBase) -> KnowledgeBaseOut:
    document_count = session.scalar(
        select(func.count()).select_from(Document).where(Document.knowledge_base_id == item.id)
    )
    chunk_count = session.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.knowledge_base_id == item.id, Chunk.enabled.is_(True))
    )
    return KnowledgeBaseOut(
        id=str(item.id),
        name=item.name,
        description=item.description,
        status=item.status,
        document_count=int(document_count or 0),
        chunk_count=int(chunk_count or 0),
        embedding_model=item.embedding_model,
        updated_at=display_time(item.updated_at),
        owner=item.owner,
        tags=list(item.tags or []),
    )


def document_out(session: Session, item: Document) -> DocumentOut:
    chunk_count = session.scalar(
        select(func.count()).select_from(Chunk).where(Chunk.document_id == item.id)
    )
    meta = item.meta
    metadata = (
        MetadataOut(
            time=meta.time,
            version=meta.version,
            subject=meta.subject,
            owner=meta.owner,
            keywords=list(meta.keywords or []),
            questions=list(meta.questions or []),
        )
        if meta
        else empty_metadata()
    )
    return DocumentOut(
        id=str(item.id),
        name=item.name,
        format=item.format,
        size=human_size(item.size_bytes),
        status=item.status,
        chunks=int(chunk_count or 0),
        parser=item.parser,
        updated_at=display_time(item.updated_at),
        error_reason=item.error_reason,
        metadata=metadata,
    )


def chunk_out(item: Chunk) -> ChunkOut:
    return ChunkOut(
        id=str(item.id),
        title=item.title,
        content=item.content,
        source=item.source,
        locator=item.locator,
        enabled=item.enabled,
        tokens=item.tokens,
    )


def import_task_out(session: Session, item: ImportTask) -> ImportTaskOut:
    knowledge_base = session.get(KnowledgeBase, item.knowledge_base_id)
    return ImportTaskOut(
        id=str(item.id),
        knowledge_base_id=str(item.knowledge_base_id),
        knowledge_base=knowledge_base.name if knowledge_base else "",
        document_id=str(item.document_id) if item.document_id else None,
        file_name=item.file_name,
        stage=item.stage,
        status=item.status,
        progress=item.progress,
        error=item.error,
        updated_at=display_time(item.updated_at),
    )


def provider_out(item: ProviderProfile) -> ProviderOut:
    return ProviderOut(
        id=str(item.id),
        provider=item.provider,
        capability=item.capability,
        name=item.name,
        model=item.model,
        endpoint=item.endpoint,
        status=item.status,
        latency_ms=item.latency_ms,
        dimension=item.dimension,
        last_checked=item.last_checked,
        error_message=item.error_message,
    )


def role_out(item: Role) -> RoleOut:
    return RoleOut(
        id=item.id,
        name=item.name,
        description=item.description,
        permissions=list(item.permissions or []),
    )


def query_log_out(item: QueryLog) -> QueryLogOut:
    return QueryLogOut(
        id=str(item.id),
        trace_id=item.trace_id,
        query=item.query,
        knowledge_base=item.knowledge_base,
        model=item.model,
        provider=item.provider,
        status=item.status,
        input_tokens=item.input_tokens,
        output_tokens=item.output_tokens,
        duration_ms=item.duration_ms,
        retrieval_ms=item.retrieval_ms,
        rerank_ms=item.rerank_ms,
        first_token_ms=item.first_token_ms,
        created_at=display_time(item.created_at),
        scenario_id=item.scenario_id,
    )
