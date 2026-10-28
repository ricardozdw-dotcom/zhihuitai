from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from app.config import get_settings
from app.models import Chunk
from app.services.embeddings import embed_query


@dataclass
class Hit:
    chunk_id: str
    title: str
    content: str
    source: str
    locator: str
    file_type: str
    dense_score: float
    keyword_score: float
    rerank_score: float
    sufficient: bool


def _bigrams(text: str) -> list[str]:
    compact = "".join(text.split())
    if len(compact) < 2:
        return [compact] if compact else []
    grams = [compact[index : index + 2] for index in range(len(compact) - 1)]
    unique: list[str] = []
    for gram in grams:
        if gram not in unique:
            unique.append(gram)
        if len(unique) >= 12:
            break
    return unique


def _keyword_score(query_grams: list[str], content: str) -> float:
    if not query_grams:
        return 0.0
    haystack = "".join(content.split())
    hits = sum(1 for gram in query_grams if gram in haystack)
    return hits / len(query_grams)


def _rrf(rank: int, k: int = 60) -> float:
    return 1.0 / (k + rank)


def retrieve(
    session: Session,
    knowledge_base_ids: list[uuid.UUID],
    query: str,
    top_k: int = 5,
    mode: str = "hybrid",
) -> tuple[list[Hit], int]:
    started = time.perf_counter()
    settings = get_settings()
    grams = _bigrams(query)
    chunks = session.scalars(
        select(Chunk)
        .options(defer(Chunk.embedding))
        .where(Chunk.knowledge_base_id.in_(knowledge_base_ids), Chunk.enabled.is_(True))
    ).all()
    keyword_ranked = sorted(
        chunks,
        key=lambda chunk: _keyword_score(grams, f"{chunk.title}\n{chunk.content}"),
        reverse=True,
    )
    keyword_ranked = [chunk for chunk in keyword_ranked if _keyword_score(grams, f"{chunk.title}\n{chunk.content}") > 0]

    dense_ranked: list[tuple[Chunk, float]] = []
    if mode in {"hybrid", "dense"} and chunks:
        try:
            vector = embed_query(query, settings)
        except Exception:
            vector = None
        if vector is not None:
            distance = Chunk.embedding.cosine_distance(vector)
            rows = session.execute(
                select(Chunk, distance.label("distance"))
                .where(
                    Chunk.knowledge_base_id.in_(knowledge_base_ids),
                    Chunk.enabled.is_(True),
                    Chunk.embedding.is_not(None),
                )
                .order_by(distance)
                .limit(max(top_k * 4, 8))
            ).all()
            dense_ranked = [(row[0], float(row[1])) for row in rows]

    scores: dict[uuid.UUID, float] = {}
    dense_map = {chunk.id: max(0.0, 1.0 - distance) for chunk, distance in dense_ranked}
    keyword_map = {chunk.id: _keyword_score(grams, f"{chunk.title}\n{chunk.content}") for chunk in chunks}
    if mode in {"hybrid", "keyword"}:
        for rank, chunk in enumerate(keyword_ranked, start=1):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + _rrf(rank)
    if mode in {"hybrid", "dense"}:
        for rank, (chunk, _distance) in enumerate(dense_ranked, start=1):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + _rrf(rank)

    ordered = sorted(scores, key=lambda item: scores[item], reverse=True)[:top_k]
    by_id = {chunk.id: chunk for chunk in chunks}
    hits: list[Hit] = []
    for chunk_id in ordered:
        chunk = by_id[chunk_id]
        keyword = keyword_map.get(chunk_id, 0.0)
        dense = dense_map.get(chunk_id, 0.0)
        combined = scores[chunk_id]
        sufficient = keyword >= 0.15 or dense >= 0.55
        suffix = chunk.source.rsplit(".", 1)[-1].upper() if "." in chunk.source else "FILE"
        hits.append(
            Hit(
                chunk_id=str(chunk.id),
                title=chunk.title,
                content=chunk.content,
                source=chunk.source,
                locator=chunk.locator,
                file_type=suffix,
                dense_score=round(dense, 3),
                keyword_score=round(keyword, 3),
                rerank_score=round(combined, 4),
                sufficient=sufficient,
            )
        )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return hits, elapsed_ms
