import io
import os
import tempfile

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://zhihuitai:zhihuitai@127.0.0.1:5432/zhihuitai")
os.environ["INGEST_INLINE"] = "true"
os.environ["BLOB_DIR"] = tempfile.mkdtemp(prefix="zhihuitai-test-")
os.environ["LLM_API_KEY"] = ""
os.environ["EMBEDDING_API_KEY"] = ""

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

command.upgrade(Config("alembic.ini"), "head")

from app.main import app

client = TestClient(app)

SAMPLE = """# 私有化部署指南

通用版本建议从单机 Docker Compose 起步，包含 API、解析 Worker 与 PostgreSQL。
默认向量维度是 1024，使用 pgvector 保存分块。
""".encode()


def test_health_reports_pgvector():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["vector"]
    assert body["embedding"] == "deterministic-hash"


def test_import_then_retrieve_and_chat():
    created = client.post(
        "/api/knowledge-bases",
        json={"name": "部署验收库", "description": "冒烟", "owner": "知识运营组"},
    )
    assert created.status_code == 200, created.text
    knowledge_base_id = created.json()["id"]

    uploaded = client.post(
        f"/api/knowledge-bases/{knowledge_base_id}/documents",
        files={"file": ("部署指南.md", io.BytesIO(SAMPLE), "text/markdown")},
    )
    assert uploaded.status_code == 200, uploaded.text
    payload = uploaded.json()
    assert payload["task"]["status"] == "success"
    document = payload["document"]
    assert document["status"] == "ready"
    assert document["metadata"]["subject"] == "私有化部署"
    assert document["metadata"]["keywords"]
    assert document["metadata"]["questions"]
    assert document["chunks"] >= 1
    listed = client.get(f"/api/knowledge-bases/{knowledge_base_id}")
    assert listed.status_code == 200
    assert listed.json()["status"] == "ready"

    chunks = client.get(f"/api/documents/{document['id']}/chunks")
    assert chunks.status_code == 200
    assert "Docker Compose" in chunks.json()[0]["content"]

    hits = client.post(
        f"/api/knowledge-bases/{knowledge_base_id}/retrieval",
        json={"query": "Docker Compose 部署需要什么", "mode": "hybrid", "topK": 3},
    )
    assert hits.status_code == 200, hits.text
    assert hits.json()
    assert any("Docker" in item["content"] for item in hits.json())

    with client.stream(
        "POST",
        "/api/chat/completions",
        json={"message": "Docker Compose 怎么部署", "knowledgeBaseIds": [knowledge_base_id]},
    ) as response:
        assert response.status_code == 200
        raw = "".join(response.iter_text())
    assert "event: citation" in raw
    assert "Docker Compose" in raw
    assert "event: done" in raw

    client.delete(f"/api/knowledge-bases/{knowledge_base_id}")
