export type RunStatus = 'success' | 'partial' | 'failed' | 'running' | 'unknown' | 'waiting' | 'cancelled';
export type NodeType = 'agent' | 'llm' | 'tool' | 'skill' | 'retrieval' | 'context' | 'harness' | 'build';
export type RunKind = 'agent' | 'build' | 'chat';
export interface TraceNode {
  id: string;
  parent?: string;
  name: string;
  type: NodeType;
  status: RunStatus;
  start: number;
  duration: number;
  input: unknown;
  output: unknown;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cost?: number | null;
  currency?: 'CNY' | 'USD';
  provider?: string;
  model?: string;
  error?: string;
  attempt?: number;
  events: string[];
  context?: Array<{ role: string; content: string; tokens: number }>;
  executionSource?: {
    path: string;
    revision: string;
    language: string;
    code: string;
    annotations?: Array<{ lines: [number, number]; title: string; detail: string }>;
  };
  tokenSource?: 'provider' | 'estimated' | 'none' | 'unknown';
}
export interface ObsRun {
  id: string;
  traceId: string;
  sessionId?: string;
  kind: RunKind;
  name: string;
  version: string;
  input: string;
  output: string;
  status: RunStatus;
  environment: 'local' | 'staging';
  knowledge: string;
  startedAt: string;
  duration: number;
  nodes: TraceNode[];
  issue?: string;
  issueNode?: string;
  feedback?: string;
  dataSource?: 'captured' | 'reported' | 'historical';
}

export const statusMeta: Record<RunStatus, { label: string; color: string }> = {
  success: { label: '成功', color: 'green' },
  partial: { label: '部分成功', color: 'orange' },
  failed: { label: '失败', color: 'red' },
  running: { label: '运行中', color: 'blue' },
  unknown: { label: '未知 · 心跳缺失', color: 'default' },
  waiting: { label: '等待人工', color: 'gold' },
  cancelled: { label: '已取消', color: 'default' },
};
export const typeLabels: Record<NodeType, string> = {
  agent: 'Agent', llm: 'LLM', tool: '工具', skill: 'Skill', retrieval: '检索',
  context: '上下文', harness: 'Harness', build: '构建',
};
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();
const node = (id: string, name: string, type: NodeType, start: number, duration: number, extra: Partial<TraceNode> = {}): TraceNode => ({
  id, name, type, start, duration, status: 'success', input: {}, output: {}, events: ['节点开始', '节点完成'], ...extra,
});
const context = [
  { role: 'system', content: '你是企业知识助手。仅根据证据回答，缺乏依据时说明限制。Prompt v1.4', tokens: 180 },
  { role: 'skill', content: 'report-writer@1.2：先检索制度，核对出处，再按摘要、依据、建议输出。', tokens: 420 },
  { role: 'user', content: '请总结远程办公申请流程，并给出制度依据。', tokens: 36 },
];
const demoEvidence = [
  { chunkId: 'policy-032', source: '员工手册.pdf', locator: '第 12 页 · 3.2 条', text: '员工需提前一个工作日提交远程办公申请。申请应包含远程办公日期、地点、工作事项与交付安排，经直属主管批准后生效。', score: 0.93 },
  { chunkId: 'policy-033', source: '远程办公制度.docx', locator: '第二章 · 第 4 条', text: '申请通过后，员工应在工作时段保持企业通讯工具在线；临时变更办公日期或事项时，应更新申请并告知直属主管。', score: 0.88 },
  { chunkId: 'policy-041', source: '远程办公制度.docx', locator: '第三章 · 第 7 条', text: '远程办公结束后，员工按申请中约定的事项提交工作进展与交付结果。跨境办公另依专项制度执行，本条不构成跨境办公许可。', score: 0.81 },
];
function agentNodes(mode: 'success' | 'retry' | 'context' | 'skill' | 'loop' | 'unknown'): TraceNode[] {
  const skillFailed = mode === 'skill';
  const base = [
    node('root', '报告撰写 Agent', 'agent', 0, 18000, { input: { task: '总结远程办公申请流程' }, output: { result: '见任务最终输出' }, events: ['run.started · Harness v0.3', '使用 Prompt v1.4 / Agent v0.8'] }),
    node('skill', 'report-writer · v1.2', 'skill', 40, skillFailed ? 280 : mode === 'context' ? 4840 : mode === 'loop' ? 6560 : mode === 'unknown' ? 17960 : mode === 'retry' ? 16360 : 14860, { parent: 'root', input: { source: 'internal/skills/report-writer', hash: 'sha256:7ea28c', trigger: '任务匹配报告撰写流程' }, output: { lifecycle: skillFailed ? '已加载 → 执行失败' : '已加载 → 执行中 → 已完成', instruction: '先检索制度，核对出处，再输出摘要、依据、建议。' }, status: skillFailed ? 'failed' : 'success', error: skillFailed ? 'SKILL_DEPENDENCY_MISSING：模板 report-template-v2 不存在' : undefined, events: skillFailed ? ['skill.loaded · 指令读取成功', 'skill.started', 'skill.failed · 缺少模板依赖；未完成'] : ['skill.loaded · 版本 1.2', 'skill.started', 'skill.completed · 输出结构校验通过；关联模型与工具见同一运行'] }),
  ];
  if (skillFailed) return [...base, node('stop', '依赖检查终止任务', 'harness', 330, 80, { parent: 'root', status: 'failed', error: 'SKILL_DEPENDENCY_MISSING', output: { stopReason: 'Skill 执行依赖缺失', modelInvoked: false }, events: ['依赖检查失败', 'run.failed'] })];
  const nodes = [...base,
    node('model-1', '规划检索 · 第 1 轮', 'llm', 350, 2800, { parent: 'root', provider: '通义百炼', model: 'qwen-plus', inputTokens: 1200, outputTokens: 160, cost: 0.00128, currency: 'CNY', input: { messages: context, temperature: 0.2, tools: [{ name: 'search_knowledge', description: '检索企业知识库并返回带定位信息的证据', parameters: { query: 'string', knowledgeBase: 'string', topK: 'integer = 10' } }] }, output: { public_plan: [{ step: 'P1', task: '检索远程办公制度', tool: 'search_knowledge' }, { step: 'P2', task: '核对条款与来源定位', requires: ['检索证据'] }, { step: 'P3', task: '输出申请流程及引用', requires: ['已核对条款'] }], tool_call: { id: 'tc-01', name: 'search_knowledge', arguments: { query: '远程办公申请流程', knowledgeBase: '员工制度库', topK: 10 } } }, context, events: ['request.sent · req-qw-101', '首 Token 420 ms', 'finish_reason: tool_calls'] }),
    node('tool', 'search_knowledge', 'tool', 3200, 1400, { parent: 'root', attempt: 1, input: { callId: 'tc-01', query: '远程办公申请流程', knowledgeBase: '员工制度库', topK: 10, indexVersion: 'idx-20261028-03' }, output: { callId: 'tc-01', count: 3, results: demoEvidence }, events: ['tool.started · schema 校验通过', 'tool.completed · 3 条证据'] }),
    node('retrieve', '混合召回 + Rerank', 'retrieval', 3250, 1200, { parent: 'tool', input: { denseTopK: 10, keywordTopK: 10, rerankModel: 'qwen3-rerank' }, output: { candidates: 14, final: 3, scores: [{ source: '员工手册.pdf', locator: '第 12 页', dense: 0.84, rerank: 0.93 }], selected: '第 3.2 条：提前一个工作日提交申请，经直属主管批准。' }, cost: 0.0003, currency: 'CNY', provider: '通义百炼', model: 'qwen3-rerank', events: ['retrieval.completed · 14 个候选', 'rerank.completed · 保留 3 块；演示按次计价'] }),
    node('context', '装配回答上下文', 'context', 4700, 180, { parent: 'root', input: { previousTokens: 1200, toolResultTokens: mode === 'context' ? 142000 : 1800 }, output: { contextLimit: 32768, reservedOutput: 4096, action: mode === 'context' ? '超出上下文窗口，终止本次请求' : '保留 3 个证据分块，未裁剪' }, status: mode === 'context' ? 'failed' : 'success', error: mode === 'context' ? 'CONTEXT_WINDOW_EXCEEDED：工具返回超过可用上下文' : undefined, events: mode === 'context' ? ['工具返回 142,000 tokens（估算）', '预算检查失败，未发送下一次模型请求'] : ['context.assembled', 'context.validated'] }),
  ];
  if (['context', 'loop', 'unknown'].includes(mode)) {
    nodes[1] = { ...nodes[1], status: mode === 'unknown' ? 'unknown' : 'partial', output: { lifecycle: '已加载 → 执行中 → 未完成', completionEvidence: null }, events: ['skill.loaded · 版本 1.2', 'skill.started', mode === 'unknown' ? '执行器终态未知；不推定 Skill 完成' : '下游流程中断；Skill 未完成'] };
  }
  if (mode === 'context') return nodes;
  if (mode === 'retry') {
    nodes[3] = { ...nodes[3], status: 'failed', duration: 1200, output: { error: '连接向量检索服务超时', sideEffect: false }, error: 'TOOL_TIMEOUT', events: ['tool.started', 'tool.failed · attempt 1'] };
    nodes[4] = { ...nodes[4], parent: 'retry-tool', start: 4750 };
    nodes[5] = { ...nodes[5], start: 6200 };
    nodes.push(node('retry-tool', 'search_knowledge · 重试', 'tool', 4700, 1450, { ...nodes[3], id: 'retry-tool', start: 4700, duration: 1450, attempt: 2, status: 'success', error: undefined, output: { callId: 'tc-01', count: 3, results: demoEvidence }, events: ['retry.scheduled · 原调用 tc-01', 'tool.completed · attempt 2'] }));
  }
  if (mode === 'unknown') return [...nodes, node('heartbeat', '等待 worker 心跳', 'harness', 6200, 11800, { parent: 'root', status: 'unknown', output: { lastHeartbeat: '节点运行后第 6.2 秒', executorFinalState: null }, events: ['worker.heartbeat.missed', '尚未收到执行器终态；不推定成功或失败'] })];
  if (mode === 'loop') return [...nodes, node('loop', '轮数限制检查', 'harness', 6200, 400, { parent: 'root', status: 'failed', input: { iterations: 12, maxIterations: 12 }, output: { stopReason: 'max_iterations' }, error: 'MAX_ITERATIONS', events: ['连续重复查询指纹 4 次', '达到 12 轮上限，执行器终止任务'] })];
  nodes.push(node('model-2', '生成最终回答 · 第 2 轮', 'llm', mode === 'retry' ? 6600 : 5100, 9800, {
    parent: 'root', provider: '通义百炼', model: 'qwen-plus', inputTokens: 3000, outputTokens: 540, cachedTokens: 600, cost: 0.00348, currency: 'CNY',
    input: { temperature: 0.2, evidence: ['员工手册.pdf / 第 12 页'], promptVersion: 'v1.4' },
    output: { answer: '员工需提前一个工作日提交远程办公申请，说明日期与工作安排，经直属主管批准后生效。[1]', citations: ['员工手册.pdf，第 12 页，第 3.2 条'] },
    context: [...context, { role: 'assistant', content: JSON.stringify({ public_plan: (nodes[2].output as { public_plan: unknown }).public_plan, tool_calls: [{ id: 'tc-01', name: 'search_knowledge', arguments: { query: '远程办公申请流程', knowledgeBase: '员工制度库', topK: 10 } }] }, null, 2), tokens: 160 }, { role: 'tool', content: JSON.stringify({ tool_call_id: 'tc-01', indexVersion: 'idx-20261028-03', results: demoEvidence }, null, 2), tokens: 1640 }],
    events: ['request.sent · req-qw-102', '首 Token 580 ms', 'finish_reason: stop', 'usage.received · 缓存 600 包含在输入 3000 内'],
  }));
  return nodes;
}

function buildNodes(failed: boolean): TraceNode[] {
  return [
    node('upload', '上传与文件校验', 'build', 0, 500, { input: { files: ['员工手册.pdf', '远程办公制度.docx', '扫描附件.pdf'] }, output: { valid: 3, duplicates: 0 }, events: ['upload.complete', '文件格式与哈希校验通过'] }),
    node('queue', '排队与分发', 'harness', 500, 1200, { input: { queue: 'documents', worker: 'worker-02' }, output: { attempt: 1 }, events: ['queued', 'worker.accepted'] }),
    node('parse', '文档解析与 OCR', 'build', 1700, 7200, { input: { parser: 'structured-v1', pages: 24, nativePages: 18, ocrPages: 6 }, output: { completedPages: failed ? 22 : 24, failedPages: failed ? [23, 24] : [], billedPages: failed ? 4 : 6, providerRequestId: 'ocr-demo-024' }, status: failed ? 'partial' : 'success', error: failed ? 'OCR_QUOTA_EXCEEDED：扫描附件第 23–24 页未完成' : undefined, cost: failed ? 0.12 : 0.18, currency: 'CNY', provider: '阿里云 OCR', model: '文档结构化', events: ['原生文本解析 18 页', '云端 OCR 已处理 4 页', failed ? '剩余 2 页因额度不足失败' : '云端 OCR 其余 2 页完成'] }),
    node('chunk', '标准化与按标题分块', 'build', 9000, 1800, { input: { method: '按标题层级', maxDepth: 4, maxSize: 800, minSize: 100 }, output: { files: failed ? 2 : 3, chunks: 86, emptyChunks: 0, oversized: 0 }, events: ['保留标题路径与表格结构', 'chunking.completed · 86 个分块'] }),
    node('embedding', '生成 Embedding', 'llm', 11000, 3400, { provider: '通义百炼', model: 'text-embedding-v4', inputTokens: 18400, outputTokens: 0, cost: 0.0092, currency: 'CNY', input: { chunks: 86, batchSize: 32, dimension: 1024 }, output: { batches: 3, written: 86 }, events: ['embedding.batch.completed · 3/3', 'usage.received'] }),
    node('publish', '索引写入与发布', 'build', 14500, 900, { input: { chunks: 86, indexVersion: 'idx-20261028-03' }, output: { written: 86, publishedFiles: failed ? 2 : 3, searchable: true }, events: ['index.written · 86/86', 'index.published · 可检索；未代表检索质量验收通过'] }),
  ];
}

const agentRun = (id: string, minutes: number, mode: Parameters<typeof agentNodes>[0], status: RunStatus, issue?: string, issueNode?: string): ObsRun => ({
  id, traceId: `trace-${id}`, sessionId: `session-${id}`, kind: 'agent', name: '报告撰写 Agent', version: 'v0.8',
  input: '请总结远程办公申请流程，并给出制度依据。',
  output: status === 'success' ? '需提前一个工作日提交申请，经直属主管批准后生效。[1]' : status === 'unknown' ? '尚未收到执行器终态' : '任务未完成，请查看异常节点。',
  status, environment: 'local', knowledge: '员工制度库', startedAt: ago(minutes), duration: mode === 'skill' ? 410 : 18000,
  nodes: agentNodes(mode).map(n => n.id === 'root' ? { ...n, status, events: [...n.events, status === 'unknown' ? '尚未收到运行终态' : `run.${status}`] } : n), issue, issueNode,
});
export const obsRuns: ObsRun[] = [
  agentRun('agent-028', 8, 'success', 'success'),
  agentRun('agent-027', 28, 'retry', 'success', 'TOOL_TIMEOUT', 'tool'),
  agentRun('agent-026', 52, 'context', 'failed', 'CONTEXT_WINDOW_EXCEEDED', 'context'),
  agentRun('agent-025', 88, 'skill', 'failed', 'SKILL_DEPENDENCY_MISSING', 'skill'),
  agentRun('agent-024', 115, 'unknown', 'unknown', 'WORKER_HEARTBEAT_MISSING', 'heartbeat'),
  agentRun('agent-023', 142, 'loop', 'failed', 'MAX_ITERATIONS', 'loop'),
  { id: 'build-012', traceId: 'trace-build-012', kind: 'build', name: '员工制度库 · 批次 012', version: 'idx-20261028-03', input: '员工手册.pdf、远程办公制度.docx、扫描附件.pdf', output: '2 个文件已发布，1 个文件 OCR 失败；已发布内容可检索。', status: 'partial', environment: 'local', knowledge: '员工制度库', startedAt: ago(65), duration: 15400, nodes: buildNodes(true), issue: 'OCR_QUOTA_EXCEEDED', issueNode: 'parse' },
  { id: 'build-011', traceId: 'trace-build-011', kind: 'build', name: '产品手册库 · 批次 011', version: 'idx-20261028-02', input: '产品手册.pdf、产品说明.docx、图文附件.pdf', output: '3 个文件已发布，共 86 个分块。', status: 'success', environment: 'staging', knowledge: '产品手册库', startedAt: ago(200), duration: 15400, nodes: buildNodes(false) },
  { ...agentRun('chat-032', 16, 'success', 'success'), kind: 'chat', name: '企业知识助手', sessionId: 'session-chat-08', version: 'v1.4', feedback: '有用', nodes: agentNodes('success').filter(n => n.type !== 'skill').map(n => ({ ...n, name: n.id === 'root' ? 'RAG 问答链路' : n.name, type: n.id === 'root' ? 'context' : n.type })) },
  { ...agentRun('chat-031', 96, 'success', 'success'), kind: 'chat', name: '企业知识助手', sessionId: 'session-chat-08', input: '可以直接在海外远程办公吗？', output: '现有知识库未提供海外远程办公规定，暂时无法给出有依据的答复。', feedback: '依据不足拒答', nodes: [node('retrieve', '知识检索 · 无匹配', 'retrieval', 0, 320, { input: { query: '海外远程办公规定' }, output: { matched: 0 }, events: ['retrieval.completed · 无结果'] }), node('response', '按策略拒答', 'context', 330, 20, { output: { answer: '未找到相关规定，无法提供有依据的答复。' }, events: ['policy.no_evidence · 未调用 LLM'] })], duration: 350 },
  { ...agentRun('chat-030', 310, 'success', 'success'), kind: 'chat', name: '产品问答助手', knowledge: '产品手册库', sessionId: 'session-chat-07', environment: 'staging', input: '标准版包括哪些功能？', output: '标准版包含知识导入、检索和带引用的对话。', nodes: [node('model', '生成产品回答', 'llm', 0, 3200, { provider: 'OpenRouter', model: '演示路由模型', inputTokens: 800, outputTokens: 200, cost: 0.002, currency: 'USD', input: { query: '标准版包括哪些功能？' }, output: { answer: '标准版包含知识导入、检索和带引用的对话。' }, events: ['usage.received', '演示 USD 定价；未换算成人民币'] })], duration: 3200 },
  { ...agentRun('agent-022', 360, 'success', 'waiting'), input: '汇总采购数据后提交审批。', output: '等待人工确认外部提交。', nodes: [node('approval', '外部提交审批', 'harness', 0, 1200, { status: 'waiting', input: { action: '提交采购汇总', approvalId: 'approval-demo-01' }, output: { approved: null }, events: ['approval.requested', '暂停等待人工；未执行外部提交'] })] },
  { ...agentRun('agent-021', 600, 'success', 'success'), environment: 'staging', nodes: [node('unknown-usage', '外部模型调用', 'llm', 0, 2500, { provider: 'AIHubMix', model: '演示兼容模型', cost: null, currency: 'CNY', output: { answer: '已完成报告摘要。' }, events: ['response.received', 'usage.missing · 金额待核价；不是零消耗'] })], duration: 2500 },
];

export function usageOf(run: ObsRun) {
  return run.nodes.reduce((acc, n) => ({
    input: acc.input + (n.inputTokens ?? 0), output: acc.output + (n.outputTokens ?? 0),
    cached: acc.cached + (n.cachedTokens ?? 0),
    cny: acc.cny + (n.currency === 'CNY' ? (n.cost ?? 0) : 0),
    usd: acc.usd + (n.currency === 'USD' ? (n.cost ?? 0) : 0),
    unknown: acc.unknown + (n.cost === null ? 1 : 0),
    tokenUnknown: acc.tokenUnknown + (n.type === 'llm' && (n.inputTokens === undefined || n.outputTokens === undefined) ? 1 : 0),
  }), { input: 0, output: 0, cached: 0, cny: 0, usd: 0, unknown: run.dataSource === 'historical' ? 1 : 0, tokenUnknown: 0 });
}
export function formatCost(run: ObsRun) {
  if (run.dataSource === 'historical') return '历史费用未采集';
  const u = usageOf(run);
  return [u.cny ? `¥${u.cny.toFixed(4)}` : '', u.usd ? `$${u.usd.toFixed(4)}` : '', u.unknown ? '待核价' : ''].filter(Boolean).join(' + ') || '¥0.0000';
}
export function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function totalUsage(runs: ObsRun[]) {
  return runs.reduce((a, run) => { const u = usageOf(run); return { input: a.input + u.input, output: a.output + u.output, cached: a.cached + u.cached, cny: a.cny + u.cny, usd: a.usd + u.usd, unknown: a.unknown + u.unknown }; }, { input: 0, output: 0, cached: 0, cny: 0, usd: 0, unknown: 0 });
}
