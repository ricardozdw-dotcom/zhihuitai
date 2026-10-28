# 知汇台 · 企业知识库中台

企业知识库中台 V1.0 的方案、可点击前端原型，以及第一版后端。

[在线页面演示](https://ricardozdw-dotcom.github.io/zhihuitai/#/evaluations) · [完整功能测试环境配置](https://codespaces.new/ricardozdw-dotcom/zhihuitai)

GitHub Pages 使用演示日志和浏览器本地 Case 存储。真实后端共享测试需自行创建 Codespace 或部署服务器，创建云环境前请确认账号额度；本仓库不会自动创建付费实例。详细步骤见 [GitHub 部署与在线测试](docs/05-GitHub部署与在线测试.md)。

- `docs/01-企业知识库中台V1-需求审查与技术方案.md`：范围、架构和验收口径
- `frontend/`：React + TypeScript + Vite + Ant Design。默认 Mock；`VITE_USE_API=true` 时知识库、导入、在线对话、可观测和评测集连接后端
- `backend/`：FastAPI、PostgreSQL + pgvector、Celery/Redis。没有模型密钥也能导入 Markdown 并做带来源的问答
- `docs/03-线上Case回流与真实日志-实施方案.md`：服务端日志、不可变 Case 快照、并发与接口设计
- `docs/04-Case回流功能-测试与交接.md`：当前已接通范围、用户测试步骤和 Agent 执行器接入方式

## 启动后端

```bash
docker compose up --build
```

API 在 [http://127.0.0.1:43180](http://127.0.0.1:43180)，健康检查是 `/api/health`。不用 Docker 的步骤、迁移和冒烟脚本见 `backend/README.md`。

## 运行原型

```bash
cd frontend
npm install
npm run dev
```

打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)。在线对话在 `/#/chat`，手动 Case 回流与评测集在 `/#/evaluations`。问答应用 `/#/apps` 仍用于场景原型。真实 API 模式的能力边界与验收步骤见 `docs/04-Case回流功能-测试与交接.md`。
