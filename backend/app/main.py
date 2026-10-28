from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.evaluations import router as evaluations_router
from app.api.chat import router as chat_router
from app.config import get_settings
from app.db import SessionLocal
from app.seed import seed
from app.services.observability import backfill_query_logs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal() as session:
        seed(session)
    backfill_query_logs()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="知汇台 API",
        version="0.1.0",
        description=(
            "企业知识库中台第一版接口。角色接口只声明权限，不替代身份认证。"
            "未配置 LLM / Embedding 密钥时，入库使用启发式元数据与确定性向量，问答返回带来源的摘录。"
        ),
        lifespan=lifespan,
    )
    origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(evaluations_router)
    app.include_router(chat_router)
    return app


app = create_app()
