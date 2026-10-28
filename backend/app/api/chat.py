import json
import uuid
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.clock import now
from app.config import get_settings
from app.db import SessionLocal
from app.models import ChatMessageRow, Conversation, KnowledgeBase, QueryLog
from app.rag.pipeline import _mock_answer, stream_answer
from app.rag.retrieve import retrieve
from app.schemas import ChatIn
from app.services.observability import ModelTraceCallback, TraceRecorder, execution_source, redact

router = APIRouter(prefix="/api", tags=["问答"])


def sse(event, payload):
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/chat/completions", summary="带完整节点记录的流式问答")
def chat(body: ChatIn):
    try:
        kb_ids = [uuid.UUID(v) for v in body.knowledge_base_ids]
    except ValueError as exc:
        raise HTTPException(422, "知识库不是有效 ID") from exc
    with SessionLocal() as session:
        names = []
        for kb_id in kb_ids:
            kb = session.get(KnowledgeBase, kb_id)
            if kb is None:
                raise HTTPException(404, "未找到知识库")
            if kb.status == "disabled":
                raise HTTPException(409, f"知识库「{kb.name}」已停用")
            names.append(kb.name)
    try:
        conversation_id = uuid.UUID(body.conversation_id) if body.conversation_id else uuid.uuid4()
    except ValueError:
        conversation_id = uuid.uuid4()

    def generate():
        settings = get_settings()
        trace = TraceRecorder(kind="chat", name="知识库在线问答", input=body.message, knowledge="、".join(names), session_id=conversation_id)
        callback = ModelTraceCallback(trace, settings)
        citations, pieces, useful = [], [], []
        retrieval_ms, first_token_ms = 0, 0
        status, error = "success", None
        active_node = None
        model, provider = (settings.llm_model, "openai-compatible") if settings.llm_configured else ("local-extractive", "local")
        with SessionLocal() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                conversation = Conversation(id=conversation_id, title=body.message[:40], scenario_id=body.scenario_id,
                                            knowledge_base_ids=[str(v) for v in kb_ids], updated_at=now())
                session.add(conversation)
                session.flush()
            session.add(ChatMessageRow(conversation_id=conversation.id, role="user", content=body.message))
            session.commit()
            try:
                active_node = trace.add("retrieval", "混合检索", "retrieval", {"query": body.message, "knowledgeBaseIds": [str(v) for v in kb_ids], "topK": 4},
                                        **({"cost": None, "tokenSource": "unknown", "provider": "openai-compatible", "model": settings.embedding_model} if settings.embedding_configured else {}),
                                        executionSource=execution_source(retrieve, "对启用分块做关键词和向量召回，以 RRF 合并排序；保留完整命中内容与实际分数。当前未调用独立 Rerank 服务。"))
                hits, retrieval_ms = retrieve(session, kb_ids, body.message, top_k=4)
                useful = [h for h in hits if h.sufficient]
                trace.end(active_node, {"hits": [asdict(h) for h in hits], "selected": [h.chunk_id for h in useful], "rerank": "未调用独立 Rerank"})
                citations = [{"id": h.chunk_id, "index": i, "source": h.source, "locator": h.locator, "score": h.rerank_score,
                              "excerpt": h.content[:180], "fileType": h.file_type} for i, h in enumerate(useful, 1)]
                context_node = trace.add("context", "选择回答证据", "context", {"question": body.message, "candidateIds": [h.chunk_id for h in hits]})
                trace.end(context_node, {"documents": [{"id": h.chunk_id, "source": h.source, "locator": h.locator, "content": h.content} for h in useful],
                                         "action": "使用 sufficient 标记选择资料；本链路不读取会话历史，无上下文压缩"})
                yield sse("citation", {"citations": citations})
                if not (settings.llm_configured and useful):
                    model, provider = "local-extractive", "local"
                    active_node = trace.add("extract", "本地原文摘录 / 无证据提示", "harness", {"question": body.message, "documents": [asdict(h) for h in useful]},
                                            cost=0, currency="CNY", inputTokens=0, outputTokens=0, tokenSource="none",
                                            provider="local", model=model,
                                            executionSource=execution_source(_mock_answer, "未配置模型或无证据时，返回原文摘录或资料不足提示；本节点未调用外部模型，不产生模型 Token。"))
                for part in stream_answer(body.message, hits, settings, callbacks=[callback]):
                    if not pieces:
                        first_token_ms = trace.elapsed()
                    pieces.append(part)
                    yield sse("token", {"text": part})
                if active_node and active_node["status"] == "running":
                    trace.end(active_node, {"answer": "".join(pieces)})
            except GeneratorExit:
                status, error = "cancelled", "CLIENT_DISCONNECTED"
                raise
            except Exception as exc:
                status, error = "failed", "RAG_EXECUTION_FAILED"
                yield sse("error", {"message": f"问答失败：{redact(str(exc))[:500]}"})
                if active_node and active_node["status"] == "running":
                    trace.end(active_node, {"message": redact(str(exc))}, status=status, error=error)
            finally:
                answer = "".join(pieces)
                for node in trace.run["nodes"][1:]:
                    if node["status"] == "running":
                        trace.end(node, {"partialOutput": answer}, status=status if status != "success" else "unknown", error=error)
                trace.finish(answer, status=status, error=error)
                # A retrieval/provider failure must not prevent a persistent terminal record.
                session.rollback()
                conversation = session.get(Conversation, conversation_id)
                session.add(ChatMessageRow(conversation_id=conversation_id, role="assistant", content=answer, citations=citations))
                usage = callback.usage
                session.add(QueryLog(trace_id=trace.run["traceId"], query=body.message, answer=answer,
                                     knowledge_base="、".join(names), knowledge_base_ids=[str(v) for v in kb_ids], model=model,
                                     provider=provider, status="error" if status == "failed" else "empty" if not useful else status,
                                     input_tokens=usage["input_tokens"] if usage else 0, output_tokens=usage["output_tokens"] if usage else 0,
                                     token_source="provider" if usage else "none" if provider == "local" else "unknown",
                                     duration_ms=trace.elapsed(), retrieval_ms=retrieval_ms, rerank_ms=0,
                                     first_token_ms=first_token_ms, scenario_id=body.scenario_id, citations=citations))
                if conversation:
                    conversation.updated_at = now()
                session.commit()
            if status == "success":
                yield sse("done", {"traceId": trace.run["traceId"], "runId": trace.run["id"], "conversationId": str(conversation_id),
                                   "noEvidence": not useful, "model": model, "provider": provider,
                                   "inputTokens": usage["input_tokens"] if usage else 0 if provider == "local" else None,
                                   "outputTokens": usage["output_tokens"] if usage else 0 if provider == "local" else None,
                                   "tokenSource": "provider" if usage else "none" if provider == "local" else "unknown"})

    return StreamingResponse(generate(), media_type="text/event-stream")
