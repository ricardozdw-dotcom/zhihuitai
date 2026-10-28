from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ProviderProfile, Role

ROLES = [
    {
        "id": "admin",
        "name": "管理员",
        "description": "配置模型和 OCR，查看日志与知识库。此接口只声明权限，不构成登录鉴权。",
        "permissions": ["kb.read", "kb.write", "model.manage", "logs.read", "chat.use"],
    },
    {
        "id": "manager",
        "name": "知识库管理人员",
        "description": "维护知识库、导入文件并做检索验收。",
        "permissions": ["kb.read", "kb.write", "chat.use"],
    },
    {
        "id": "user",
        "name": "使用者",
        "description": "在已发布知识库中提问。",
        "permissions": ["kb.read", "chat.use"],
    },
]

PROVIDERS = [
    ("OpenRouter", "LLM", "对话模型", "openai/gpt-4o-mini", "https://openrouter.ai/api/v1", None),
    ("OpenRouter", "Embedding", "向量模型", "text-embedding-3-small", "https://openrouter.ai/api/v1", 1024),
    ("通义百炼", "Rerank", "重排模型", "qwen3-rerank", "https://dashscope.aliyuncs.com/compatible-api/v1", None),
    ("阿里云 OCR", "OCR", "文档识别", "document-structure", "https://ocr-api.cn-hangzhou.aliyuncs.com", None),
]


def seed(session: Session) -> None:
    for item in ROLES:
        if session.get(Role, item["id"]) is None:
            session.add(Role(**item))
    existing = session.scalar(select(func.count()).select_from(ProviderProfile)) or 0
    if existing == 0:
        for provider, capability, name, model, endpoint, dimension in PROVIDERS:
            session.add(
                ProviderProfile(
                    provider=provider,
                    capability=capability,
                    name=name,
                    model=model,
                    endpoint=endpoint,
                    status="untested",
                    dimension=dimension,
                )
            )
    session.commit()
