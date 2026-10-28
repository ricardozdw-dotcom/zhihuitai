# GitHub 部署与在线测试

仓库：<https://github.com/ricardozdw-dotcom/zhihuitai>

## 在线页面演示

<https://ricardozdw-dotcom.github.io/zhihuitai/#/evaluations>

选择“管理员”可查看全部模块。页面顶部标记“GitHub 在线演示”：使用内置演示日志，Case 保存在当前浏览器，支持刷新保留、标注、筛选、归集和 JSON 导出。此链接不连接本机 API，也不能用来证明跨浏览器共享或真实模型调用成功。

GitHub Pages 只托管静态文件，不能运行本项目的 Python API、PostgreSQL、Redis。依据：[GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。

## 完整功能测试环境

仓库已提供 `.devcontainer` 配置，供你选择在 GitHub Codespaces 启动独立测试环境。配置本身不创建云实例，也不启动付费资源。

1. 打开 [Codespaces 创建页面](https://codespaces.new/ricardozdw-dotcom/zhihuitai)，确认账号、额度和机器规格后由你创建。
2. 等待环境安装依赖、启动 pgvector / Redis、迁移数据库并启动前后端。Ports 中会出现 43123，打开该端口即可测试。
3. 保持端口为 Private。此阶段项目本身没有登录鉴权，Codespaces 的私有转发依赖 GitHub 登录访问。
4. 进入页面选择管理员，新建知识库、上传 Markdown、完成真实问答，再进入可观测中心回流 Case。本环境连接独立数据库，不包含你本机已上传的文件或验收 Case。
5. 如需真实模型，请在 Codespaces Secrets 或未提交的 `backend/.env` 中填写 `LLM_*` / `EMBEDDING_*`，然后重启 API。不要把密钥写进前端变量或提交到仓库。未配置时仍可测试本地原文摘录链路。
6. 测试结束后停止 Codespace；不再需要时先导出 Case / 备份数据库，再删除。Codespaces 计算与存储使用账号额度，超额可能计费。

本次配置未代你创建 Codespace；完整环境实际启动后仍需检查安装日志。CI 会验证数据库迁移、API 流程、前端测试和 Compose 配置，但不等同于已启动一个长期运行的云测试服务。

手动启动 / 重启：在 Codespaces 终端执行 `bash .devcontainer/start.sh`。服务日志位于 `.devcontainer/.runtime/`。

配置依据：[GitHub Dev Containers 官方说明](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers)。如使用你自己的测试服务器，按根目录 Docker Compose 配置部署后端，再配置前端 API 地址；服务器地址、域名与部署权限需另行提供。

## 自动检查与发布

推送 main 后，GitHub Actions 安装锁定的 Node 依赖，执行前端测试并构建；另一任务在临时 pgvector PostgreSQL 上执行后端测试。两者通过后，发布 frontend/dist 到 Pages。代码修改以后重新推送即可更新线上页面，无需手动上传编译文件。

Pages 明确使用 `VITE_USE_API=false`；完整测试环境使用 `VITE_USE_API=true`。本机 `.env.local` 不上传，不会使公网演示尝试访问 127.0.0.1 或未部署的 `/api`。
