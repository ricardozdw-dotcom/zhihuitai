# 线上 Case 回流与真实日志实施方案

本轮将已确认的可观测与评测集原型接通后端，完成真实问答、构建过程的观测与人工 Case 沉淀。保留已有 React + Ant Design / FastAPI + PostgreSQL + LangChain 技术栈。

## 数据与边界

- `observed_runs` 保存完整执行记录；节点包含输入输出、上下文、事件、异常、用量及可提供的执行代码和解释。平台内置链路标记 captured；外部执行器通过结构化接口上报，标记 reported；旧查询日志标记 historical，明确未采集的内部证据。
- `evaluation_datasets`、`evaluation_cases`、`evaluation_memberships` 分别保存评测集、唯一 Case 与多对多归属。回流由服务器读取源记录，客户端不能提交或改写源快照。数据库触发器保护快照不可修改，源日志清理不级联删除 Case。
- 相同 run / trace 只生成一个 Case，重复回流只补充归属，不覆盖人工标注。原始运行锁与数据库唯一约束处理并发。标注用 revision 乐观锁避免覆盖。
- 保留浏览器原型数据用于演示模式；API 模式不自动把演示 Case 混入真实评测集。原型存储不会被删除。
- 本期为人工收集与标注，不执行自动打分或批量模型评测，不构造模型未对外输出的内部思考。Agent 执行器上报公开 Plan、Action、Observation、Skill / Harness 事件及代码记录，平台不据此运行任意代码。

## 接口

- `GET /api/observability/runs` 分页列表；`GET /api/observability/runs/{id}` 单条记录。
- `POST /api/observability/runs` 外部执行器按顺序上报完整运行，校验调用树、状态、内容大小；运行结束后证据不可覆盖。
- `GET /api/evaluations/state` 当前共享评测集与 Case。
- `POST /api/evaluations/datasets` 新建集合；重名返回 409。
- `POST /api/evaluations/cases` 服务端快照与幂等回流。
- `PATCH /api/evaluations/cases/{id}` 带 expectedRevision 的人工标注更新。
- `POST /api/evaluations/cases/bulk-collect` 原子批量归集；任一来源无效则整批不写入。

## 取舍

PostgreSQL 事务和唯一约束能解决共享、并发去重、持久化，无需额外日志 SaaS；代价是完整上下文与快照占用数据库空间，V1 评测集视图一次加载当前样本，后续大规模使用需要分页与归档。保留 JSONB 证据便于适配不同 Agent Harness，类型化边界与树校验约束记录质量。节点代码只展示、解释，不在浏览器执行。

模型 Token 使用供应商返回的 LangChain usage_metadata；未返回时显示未知。未配置单价时费用为待核价，不伪造账单。未配置模型密钥时沿用明确标记的本地摘录链路，允许验证数据流程。

使用量采集依据：[LangChain UsageMetadataCallbackHandler](https://reference.langchain.com/python/langchain-core/callbacks/usage/UsageMetadataCallbackHandler)，并已核对本机安装的 langchain-core 1.7.0。按节点分别统计实际返回用量，缓存读取作为输入子项，不重复计费。

不增加登录，延续当前内网 V1 的角色视图；角色选择不是鉴权。运行接口与日志仅应在受控的本机或内网环境访问。

## 验收

创建知识库 → 导入 Markdown → 构建记录 → 在线问答 → 对话节点日志 → 回流 goodcase / badcase → 多评测集去重归集 → 标注 → 刷新 / 新浏览器查看 → JSON 导出。验证异常记录、未知计费、并发回流、陈旧标注冲突、无效批量事务回滚、源日志删除后快照完整保留。
