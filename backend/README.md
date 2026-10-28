# 知汇台后端

FastAPI + PostgreSQL/pgvector + Redis/Celery。没有供应商密钥时也能完成建库、导入、检索和带来源的问答。

## Mac 上用 Docker Compose

在仓库根目录：

```bash
docker compose up --build
```

API 监听 [http://127.0.0.1:43180](http://127.0.0.1:43180)，文档在 [http://127.0.0.1:43180/docs](http://127.0.0.1:43180/docs)。Postgres 使用 `pgvector/pgvector:pg16`，API 与 Worker 分开。Compose 里 `INGEST_INLINE=false`，解析由 Worker 执行。上传接口会立刻返回任务，前端或 `GET /api/import-tasks/{id}` 轮询到 `success`。

## 本机不用 Docker

需要 PostgreSQL 16（已安装 pgvector）和 Redis。

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 43180
```

另开一个终端跑 Worker（仅当 `.env` 里 `INGEST_INLINE=false`）：

```bash
celery -A app.workers.celery_app:celery_app worker --loglevel=info
```

默认 `INGEST_INLINE=true`，API 进程内就能导入，可以不启 Worker。

冒烟：

```bash
bash scripts/smoke.sh
```

测试：

```bash
pytest
```

## 已经接通 / 仍然是存根

接通：

- 知识库、文档、六字段元数据、分块（1024 维 `vector`）和导入任务
- Markdown、纯文本、CSV，以及带文本层的 PDF
- 关键词 + 向量混合检索；LangChain Runnable 组装回答，SSE 输出引用
- 本地目录 BlobStore；`BlobStore` 接口留给 OSS/S3
- 角色与权限只读声明，供应商配置存根，查询日志

存根，未接真实能力：

- 登录和鉴权。角色接口不能当成安全边界，调用方不因请求头里的角色被放行或拒绝
- 云 OCR。扫描 PDF 会失败并写明原因，不会假装成功
- 未配置 `LLM_*` / `EMBEDDING_*` 时：元数据用文件名和正文启发式抽取，向量用确定性哈希，回答是摘录而不是大模型生成
- Rerank 远程调用。分数来自 RRF，不访问重排服务
- Word、表格、图片解析
- 供应商密钥不入库。运行时密钥只来自环境变量

前端默认是 Mock。要使用真实 API，在 `frontend/.env.local` 设置 `VITE_USE_API=true` 后重启 Vite。知识库、导入、在线对话、可观测记录与评测集会读写服务端。

可观测与人工评测集已接通：新问答与新构建任务记录完整节点数据，外部 Agent 执行器可通过 `POST /api/observability/runs` 上报。Case 回流从服务端源记录取快照，支持并发去重、多集合归属、带版本检查的人工标注及批量归集。PostgreSQL 触发器禁止改写快照，源日志删除不会影响 Case。接口见 `/docs`，操作步骤和能力边界见 `../docs/04-Case回流功能-测试与交接.md`。

Token 从 LangChain 回调的 `usage_metadata` 采集；供应商没有返回时为未知。未配置单价不估造费用。原来的历史日志只迁移当时已保存的请求、结果与引用，不补造内部调用链。
