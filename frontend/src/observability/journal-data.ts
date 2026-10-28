import type { ObsRun, TraceNode } from './data';

export type JournalKind = 'input' | 'plan' | 'action' | 'observation' | 'context' | 'exception' | 'lifecycle' | 'output';
export interface JournalEvent {
  id: string;
  nodeId?: string;
  time: number;
  round: number;
  kind: JournalKind;
  label: string;
  summary: string;
  payload: unknown;
  source: string;
  direction?: string;
  related?: string[];
  node?: TraceNode;
}

export const journalLabels: Record<JournalKind, string> = {
  input: 'INPUT', plan: 'PLAN', action: 'ACTION', observation: 'OBSERVATION',
  context: 'CONTEXT', exception: 'EXCEPTION', lifecycle: 'RUNTIME', output: 'OUTPUT',
};

function roundFor(run: ObsRun, node: TraceNode) {
  const models = run.nodes.filter(n => n.type === 'llm' && !n.model?.includes('embedding')).sort((a, b) => a.start - b.start);
  if (node.id === 'root' || node.type === 'skill') return 0;
  const round = models.filter(n => n.start <= node.start).length;
  return Math.max(1, round);
}

export function buildJournal(run: ObsRun): JournalEvent[] {
  const result: JournalEvent[] = [{ id: 'task-input', nodeId: 'root', time: 0, round: 0, kind: 'input', label: '接收任务', summary: run.input, payload: { message: { role: 'user', content: run.input }, runId: run.id, traceId: run.traceId, sessionId: run.sessionId ?? null, agentVersion: run.version }, source: '入口请求 · 演示', direction: '使用者 → Agent' }];
  const ordered = [...run.nodes].filter(n => n.id !== 'root').sort((a, b) => a.start - b.start);
  for (const node of ordered) {
    const round = roundFor(run, node);
    const publicPlan = (node.output as { public_plan?: unknown } | null)?.public_plan;
    const kind: JournalKind = node.type === 'context' ? 'context' : ['llm', 'tool', 'retrieval'].includes(node.type) ? 'action' : 'lifecycle';
    const input = node.context ? {
      ...node.input as object,
      messages: Array.isArray((node.input as { messages?: unknown } | null)?.messages) ? (node.input as { messages: unknown[] }).messages : node.context.map(c => ({ role: c.role, content: c.content })),
      requestMetadata: { provider: node.provider, model: node.model, attempt: node.attempt ?? 1 },
    } : node.input;
    result.push({ id: `${node.id}:start`, nodeId: node.id, time: node.start, round, kind,
      label: node.type === 'llm' ? `模型请求 · ${node.name}` : node.type === 'skill' ? '加载并执行 Skill' : node.type === 'context' ? '上下文装配与预算检查' : `开始 · ${node.name}`,
      summary: node.type === 'llm' ? '展开查看完整示例消息、工具定义与请求参数' : node.type === 'tool' ? `调用参数、call ID、重试次数与实现入口` : node.name,
      payload: input, source: node.type === 'llm' ? '模型请求快照 · 演示' : '执行器事件 · 演示', direction: node.type === 'llm' ? 'Agent → 模型' : node.type === 'tool' ? 'Agent → 工具' : 'Harness → 节点', node,
      related: node.parent ? [node.parent] : [],
    });
    if (publicPlan) result.push({ id: `${node.id}:plan`, nodeId: node.id, time: node.start + node.duration - 1, round, kind: 'plan', label: '公开任务计划 · Plan', summary: '模型响应中显式输出的步骤与依赖，逐项保留', payload: publicPlan, source: '模型响应 public_plan · 演示', node, direction: '模型 → Agent' });
    if (node.status === 'running') continue; // No completion event exists until the executing node reports one.
    const isException = Boolean(node.error) || ['failed', 'unknown', 'waiting', 'partial'].includes(node.status);
    const outputKind: JournalKind = isException ? 'exception' : node.type === 'context' ? 'context' : node.type === 'skill' || node.type === 'harness' ? 'lifecycle' : 'observation';
    result.push({ id: `${node.id}:end`, nodeId: node.id, time: node.start + node.duration, round: node.type === 'skill' ? roundFor(run, { ...node, start: node.start + node.duration, type: 'context' }) : round,
      kind: outputKind,
      label: node.type === 'llm' ? `模型响应 · ${node.name}` : node.type === 'tool' ? `工具返回 · ${node.name}` : node.type === 'skill' ? 'Skill 生命周期结果' : `结果 · ${node.name}`,
      summary: node.error ?? (node.status === 'unknown' ? '尚未收到终态，保留最后已知事件' : node.status === 'waiting' ? '等待审批，尚未执行外部动作' : '节点实际返回与事件记录'),
      payload: { output: node.output, status: node.status, ...(node.error ? { error: { code: node.error.split('：')[0], detail: node.error, capturedAt: node.start + node.duration, attempt: node.attempt ?? 1 } } : {}), events: node.events, ...(node.type === 'llm' ? { usage: { input_tokens: node.inputTokens ?? null, output_tokens: node.outputTokens ?? null, cached_input_tokens: node.cachedTokens ?? null }, cost: node.cost ?? null, cost_source: node.cost == null ? '待核价' : run.dataSource ? '运行记录' : '演示估算' } : {}) },
      source: node.type === 'llm' ? '模型响应 / usage · 演示' : '执行器返回 / 事件 · 演示',
      direction: node.type === 'llm' ? '模型 → Agent' : node.type === 'tool' ? '工具 → Agent' : '节点 → Harness', node,
      related: node.id === 'tool' && node.status === 'failed' && run.nodes.some(n => n.id === 'retry-tool') ? ['retry-tool'] : node.id === 'context' ? run.nodes.filter(n => n.type === 'llm' && n.start > node.start).map(n => n.id) : [],
    });
  }
  result.push({ id: 'task-output', time: Math.max(run.duration, ...run.nodes.map(n => n.start + n.duration)), round: 99, kind: 'output', label: ['unknown', 'waiting', 'running'].includes(run.status) ? '最后已知状态 · 尚无最终完成结果' : '任务结果与结束状态', summary: run.output, payload: { answer: run.output, status: run.status, issue: run.issue ?? null, ...(run.status === 'success' ? { completed: true } : { completed: false }) }, source: '任务状态记录 · 演示', direction: 'Agent → 使用者' });
  if (run.dataSource) result.forEach(event => { event.source = event.source.replace(' · 演示', ' · 运行记录'); event.summary = event.summary.replace('完整示例消息', '已记录消息'); });
  return result.sort((a, b) => a.time - b.time || (a.kind === 'plan' ? -1 : 0));
}

export interface CodeExample {
  path: string;
  language: string;
  code: string;
  explanation: Array<{ lines: [number, number]; title: string; detail: string }>;
  origin?: 'captured' | 'example';
  revision?: string;
}

const examples: Record<string, CodeExample> = {
  tool: {
    path: '示例 / tools/search_knowledge.py', language: 'Python',
    code: `async def search_knowledge(query, knowledge_base, top_k=10):
    params = validate_search(query, knowledge_base, top_k)
    candidates = await retriever.ainvoke(params)
    ranked = await reranker.ainvoke(candidates)
    evidence = attach_source_locations(ranked[:top_k])
    return {"count": len(evidence), "evidence": evidence}`,
    explanation: [
      { lines: [1, 2], title: '校验调用参数', detail: '接收模型提交的参数，检查查询、知识库范围和召回数量。这里只解释调用过程，不在观测页面执行检索。' },
      { lines: [3, 4], title: '执行检索并重排', detail: '先获得候选分块，再用 Rerank 重新排序。这两步对应同一工具下的检索节点；超时应由执行器记录为失败事件。' },
      { lines: [5, 6], title: '保留来源并返回 Observation', detail: '输出文本与文档位置。工具返回进入下一次模型请求的上下文；返回内容与模型最终回答分别保留。' },
    ],
  },
  llm: {
    path: '示例 / agent/model_step.py', language: 'Python',
    code: `async def model_step(state, model, tools):
    messages = assemble_messages(state)
    validate_context_budget(messages, reserve_output=4096)
    response = await model.bind_tools(tools).ainvoke(messages)
    state.messages.append(response)
    return response`,
    explanation: [
      { lines: [1, 2], title: '装配本轮实际消息', detail: '从任务状态中取出系统配置、历史消息、Skill 指令及已返回的工具证据。观测的是发送快照，不从最终回答反推上下文。' },
      { lines: [3, 4], title: '检查预算并发送请求', detail: '超限时记录检查失败；通过后绑定工具定义并调用模型。输入输出、首 Token 和 usage 分别记录。' },
      { lines: [5, 6], title: '将响应写回状态', detail: '响应可包含公开计划、工具调用请求或最终正文。工具调用请求交给执行器，不能当作工具已成功执行。' },
    ],
  },
  context: {
    path: '示例 / harness/context_budget.py', language: 'Python',
    code: `def validate_context_budget(messages, reserve_output=4096):
    usage = estimate_message_tokens(messages)
    available = model_limit - reserve_output
    if usage > available:
        raise ContextWindowExceeded(usage, available)
    return {"used": usage, "available": available}`,
    explanation: [
      { lines: [1, 3], title: '计算可用输入预算', detail: '在模型窗口中预留输出空间。估算 Token 应带估算标记，不替代供应商实际 usage。' },
      { lines: [4, 5], title: '在发送前阻断超限请求', detail: '异常进入本次执行实录，保留引发增长的工具返回和上下文组成；未发送的请求不虚构模型输出。' },
      { lines: [6, 6], title: '记录检查结果', detail: '检查通过只表示满足长度约束，不代表证据正确或回答质量合格。' },
    ],
  },
  skill: {
    path: '示例 / skills/report_writer/runner.py', language: 'Python',
    code: `async def execute_skill(name, task):
    spec = registry.load(name, version="1.2")
    emit("skill.loaded", spec.hash)
    validate_dependencies(spec)
    result = await executor.run(spec, task)
    emit("skill.completed", result)
    return result`,
    explanation: [
      { lines: [1, 3], title: '加载指定版本的 Skill', detail: '记录名称、版本、来源和哈希。skill.loaded 只说明指令被加载，不能证明任务已完成。' },
      { lines: [4, 5], title: '校验依赖并执行流程', detail: '缺少模板、工具或权限时，记录失败位置。执行阶段的模型与工具调用仍保留各自的输入输出。' },
      { lines: [6, 7], title: '有完成依据后记录成功', detail: '只有执行器返回可确认的结果，才输出完成事件；等待或失联应保留未知状态。' },
    ],
  },
  harness: {
    path: '示例 / harness/execute_step.py', language: 'Python',
    code: `async def execute_step(step, state):
    guard.check_iterations(state.iterations)
    guard.check_budget(state.usage)
    try:
        return await executor.run(step, timeout=state.timeout)
    except ExecutionError as error:
        emit("step.failed", code=error.code)
        raise`,
    explanation: [
      { lines: [1, 3], title: '检查执行边界', detail: '轮数与资源预算由 Harness 决定；限制事件与模型响应分别记录。' },
      { lines: [4, 5], title: '运行当前动作', detail: '执行器负责调用工具或子流程。观测页面仅查看已有记录，不重新执行任何外部动作。' },
      { lines: [6, 8], title: '保留异常并向上传播', detail: '记录错误码、调用节点和尝试次数；是否重试由执行策略决定，不把异常覆盖成最终输出。' },
    ],
  },
  build: {
    path: '示例 / ingestion/build_document.py', language: 'Python',
    code: `async def build_document(file, config):
    parsed = await parser.parse(file, ocr=config.ocr)
    chunks = splitter.split(parsed, config.chunking)
    vectors = await embeddings.aembed_documents(chunks)
    await index.write(chunks, vectors)
    return await index.publish(file.version)`,
    explanation: [
      { lines: [1, 2], title: '解析文档与 OCR', detail: '保留页码及解析告警；失败页有独立记录，不能只保存最终文件状态。' },
      { lines: [3, 4], title: '分块与向量化', detail: '分块策略和模型配置作为参数快照，Embedding 费用按调用级用量统计。' },
      { lines: [5, 6], title: '写入并发布', detail: '索引写入与可检索发布是两个阶段。发布成功不代表检索质量已验收。' },
    ],
  },
};

export function codeForNode(node: TraceNode): CodeExample {
  if (node.executionSource) {
    const source = node.executionSource;
    return { path: source.path, revision: source.revision, language: source.language, code: source.code, explanation: source.annotations ?? [], origin: 'captured' };
  }
  return { ...(examples[node.type === 'retrieval' ? 'tool' : node.type === 'agent' ? 'harness' : node.type] ?? examples.harness), origin: 'example' };
}
