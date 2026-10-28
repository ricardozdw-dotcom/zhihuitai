"""Local trace collector. Evidence is captured by the executing process, never synthesized."""
import copy
import hashlib
import inspect
import time
import uuid
from datetime import datetime
from typing import Callable

from langchain_core.callbacks import BaseCallbackHandler

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.clock import now
from app.config import get_settings
from app.db import SessionLocal
from app.models import ObservedRun, QueryLog


def redact(value):
    settings = get_settings()
    secrets = [settings.llm_api_key, settings.embedding_api_key, settings.rerank_api_key]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "***")
        return value
    if isinstance(value, dict):
        return {k: "***" if k.lower().replace("-", "").replace("_", "") in {"apikey", "xapikey", "authorization", "accesstoken", "secret", "password", "cookie", "setcookie"} else redact(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [redact(v) for v in value]
    return value


def execution_source(function: Callable, explanation: str) -> dict:
    code = inspect.getsource(function)
    return {
        "path": f"{function.__module__.replace('.', '/')}.py::{function.__name__}",
        "revision": f"sha256:{hashlib.sha256(code.encode()).hexdigest()[:16]}",
        "language": "python", "code": code,
        "annotations": [{"lines": [1, len(code.splitlines())], "title": function.__name__, "detail": explanation}],
    }


def save_run(payload: dict):
    payload = redact(copy.deepcopy(payload))
    stamp = now()
    with SessionLocal.begin() as session:
        statement = insert(ObservedRun).values(
            id=payload["id"], trace_id=payload["traceId"], kind=payload["kind"], status=payload["status"],
            payload=payload, created_at=datetime.fromisoformat(payload["startedAt"]), updated_at=stamp,
        )
        session.execute(statement.on_conflict_do_update(index_elements=[ObservedRun.id], set_={
            "status": payload["status"], "payload": payload, "updated_at": stamp,
        }))


class TraceRecorder:
    def __init__(self, *, kind: str, name: str, input: str, knowledge: str, session_id=None, trace_id=None):
        self.started = time.perf_counter()
        trace_id = trace_id or uuid.uuid4().hex
        self.run = {"id": f"{kind}-{trace_id}", "traceId": trace_id, "kind": kind, "name": name,
                    "input": input, "output": "", "knowledge": knowledge, "version": "backend-v1.1",
                    "status": "running", "environment": "local", "startedAt": now().isoformat(),
                    "duration": 0, "nodes": [], "dataSource": "captured"}
        if session_id:
            self.run["sessionId"] = str(session_id)
        self.add("root", name, "agent" if kind == "agent" else "build" if kind == "build" else "harness", {"task": input}, parent=None)

    def elapsed(self):
        return max(0, int((time.perf_counter() - self.started) * 1000))

    def add(self, id, name, type, input, parent="root", **extra):
        node = {"id": id, "name": name, "type": type, "status": "running", "start": self.elapsed(),
                "duration": 0, "input": input, "output": None, "events": [f"{type}.started"], **extra}
        if parent:
            node["parent"] = parent
        self.run["nodes"].append(node)
        self.publish()
        return node

    def end(self, node, output, *, status="success", error=None, **extra):
        node.update(output=output, status=status, duration=self.elapsed() - node["start"], **extra)
        node["events"].append(f"{node['type']}.{status}")
        if error:
            node["error"] = error
            if node["id"] != "root" or not self.run.get("issueNode"):
                self.run.update(issue=error, issueNode=node["id"])
        self.publish()

    def publish(self):
        self.run["duration"] = self.elapsed()
        save_run(self.run)

    def finish(self, output, status="success", error=None):
        self.run.update(output=output, status=status)
        self.end(self.run["nodes"][0], {"result": output}, status=status, error=error)


class ModelTraceCallback(BaseCallbackHandler):
    """Capture the exact public LangChain messages and returned usage, not hidden reasoning."""
    def __init__(self, recorder, settings):
        self.recorder, self.settings = recorder, settings
        self.node = None
        self.usage = None

    def on_chat_model_start(self, serialized, messages, **kwargs):
        from app.rag.pipeline import build_answer_chain
        context = [{"role": m.type, "content": m.content if isinstance(m.content, str) else str(m.content),
                    "tokens": max(0, len(str(m.content)) // 2)} for m in messages[0]]
        self.node = self.recorder.add("llm", "LangChain 模型生成", "llm", {"messages": context, "temperature": 0.2},
                                     provider="openai-compatible", model=self.settings.llm_model, cost=None,
                                     context=context, tokenSource="unknown",
                                     executionSource=execution_source(build_answer_chain, "装配资料与问题，生成实际请求消息并调用配置的兼容 OpenAI 模型；这里只采集公开请求和返回，Token 以 usage_metadata 为准。"))

    def on_llm_end(self, response, **kwargs):
        generation = response.generations[0][0]
        message = getattr(generation, "message", None)
        self.usage = getattr(message, "usage_metadata", None)
        extra = {}
        if self.usage:
            extra = {"inputTokens": self.usage["input_tokens"], "outputTokens": self.usage["output_tokens"],
                     "cachedTokens": self.usage.get("input_token_details", {}).get("cache_read", 0), "tokenSource": "provider"}
        if self.node:
            self.recorder.end(self.node, {"content": getattr(message, "content", generation.text),
                                         "responseMetadata": getattr(message, "response_metadata", {}), "usage": self.usage}, **extra)

    def on_llm_error(self, error, **kwargs):
        if self.node:
            self.recorder.end(self.node, {"message": str(error)}, status="failed", error="MODEL_CALL_FAILED")


def backfill_query_logs():
    """Old logs have no node/context evidence. Preserve only what actually exists."""
    with SessionLocal.begin() as session:
        rows = session.scalars(select(QueryLog).where(~QueryLog.trace_id.in_(select(ObservedRun.trace_id)))).all()
        for row in rows:
            status = "failed" if row.status == "error" else "success"
            payload = {"id": f"chat-{row.trace_id}", "traceId": row.trace_id, "kind": "chat", "name": "历史知识问答",
                       "version": "historical", "input": row.query, "output": row.answer, "status": status,
                       "knowledge": row.knowledge_base, "environment": "local", "startedAt": row.created_at.isoformat(),
                       "duration": row.duration_ms, "dataSource": "historical", "nodes": [
                           {"id": "legacy", "name": "历史请求记录（未采集内部调用链）", "type": "harness", "status": status,
                            "start": 0, "duration": row.duration_ms, "input": {"query": row.query},
                            "output": {"answer": row.answer, "citations": row.citations, "context": "历史日志未采集"},
                            "events": ["历史记录迁移；未补造 Plan、工具或上下文"]}]}
            statement = insert(ObservedRun).values(id=payload["id"], trace_id=row.trace_id, kind="chat", status=status,
                                                   payload=redact(payload), created_at=row.created_at, updated_at=now())
            session.execute(statement.on_conflict_do_nothing())
