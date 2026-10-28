import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Select, Space, Tabs, Tag, Timeline, Tooltip } from 'antd';
import { ArrowLeftOutlined, CopyOutlined, FileSearchOutlined } from '@ant-design/icons';
import { formatCost, formatTime, statusMeta, typeLabels, usageOf, type ObsRun, type TraceNode } from './data';
import { ExecutionJournal } from './ExecutionJournal';
import { CaptureCaseButton } from '../evaluations/CaptureCaseButton';

export function StatusTag({ status }: { status: ObsRun['status'] }) {
  return <Tag color={statusMeta[status].color}>{statusMeta[status].label}</Tag>;
}

function JsonContent({ value, query }: { value: unknown; query: string }) {
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const text = content ?? '未采集';
  if (!query) return <pre className="obs-json">{text}</pre>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <pre className="obs-json">{parts.map((part, index) => part.toLowerCase() === query.toLowerCase() ? <mark key={index}>{part}</mark> : part)}</pre>;
}

function NodeInspector({ node, run }: { node: TraceNode; run: ObsRun }) {
  const [tab, setTab] = useState('io');
  const [query, setQuery] = useState('');
  const [raw, setRaw] = useState(false);
  const [compare, setCompare] = useState(false);
  const [copyState, setCopyState] = useState('复制');
  const previous = run.nodes.filter(n => n.type === 'llm' && n.start < node.start).at(-1);
  const currentContext = node.context ?? [];
  const previousRoles = new Set(previous?.context?.map(c => c.role));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ input: node.input, output: node.output }, null, 2));
      setCopyState('已复制');
    } catch { setCopyState('复制失败，请选择文本复制'); }
  };
  return <section className="obs-inspector">
    <header className="obs-inspector-head">
      <div><span className={`obs-node-kind obs-node-kind--${node.type}`}>{typeLabels[node.type]}</span><h3>{node.name}</h3></div>
      <StatusTag status={node.status} />
    </header>
    <div className="obs-inspector-facts"><span>节点 <b>{node.id}</b></span><span>耗时 <b>{(node.duration / 1000).toFixed(2)}s</b></span><span>尝试 <b>{node.attempt ?? 1}</b></span></div>
    {node.error ? <Alert type="error" showIcon title={node.error} /> : null}
    <Tabs activeKey={tab} onChange={setTab} size="small" items={[
      { key: 'io', label: '输入输出' }, { key: 'context', label: '上下文' },
      { key: 'usage', label: '用量费用' }, { key: 'events', label: '事件' }, { key: 'raw', label: '原始记录' },
    ]} />
    {tab === 'io' ? <>
      <div className="obs-inspector-tools"><Input size="small" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索输入输出内容" allowClear /><Button size="small" onClick={() => setRaw(v => !v)}>{raw ? '格式化' : '原文'}</Button><Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>{copyState}</Button></div>
      <div className="obs-content-label">INPUT <span>{run.dataSource ? '记录的实际内容' : '采集内容 · 演示'}</span></div>
      <JsonContent value={raw ? JSON.stringify(node.input) : node.input} query={query} />
      <div className="obs-content-label">OUTPUT <span>{node.status === 'waiting' ? '等待执行，尚无结果' : '节点返回'}</span></div>
      <JsonContent value={raw ? JSON.stringify(node.output) : node.output} query={query} />
      {node.type === 'skill' ? <Alert type="info" showIcon title="Skill 按生命周期记录；加载指令成功不代表流程执行完成。" /> : null}
    </> : null}
    {tab === 'context' ? currentContext.length ? <>
      <div className="obs-context-summary"><div><small>本次输入 Token</small><strong>{node.inputTokens?.toLocaleString() ?? '未知'}</strong></div><div><small>预留输出</small><strong>{run.dataSource ? '未记录' : '4,096'}</strong></div><div><small>窗口上限</small><strong>{run.dataSource ? '未记录' : '32,768'}</strong></div></div>
      <div className="obs-context-meter">{currentContext.map(c => <Tooltip key={`${c.role}-${currentContext.indexOf(c)}`} title={`${c.role}：${c.tokens} tokens（分项估算）`}><span className={`obs-context-part obs-context-part--${c.role}`} style={{ flex: c.tokens }}>{c.role}</span></Tooltip>)}</div>
      <p className="obs-note">分项为字符估算，未列出的输入含格式和工具定义开销；实际请求用量以供应商 usage 为准。</p>
      <Button size="small" disabled={!previous?.context} onClick={() => setCompare(v => !v)}>{compare ? '退出上下文比较' : '与上一次模型调用比较'}</Button>
      {currentContext.map((c, index) => <article key={`${c.role}-${index}`} className={`obs-context-message${compare && !previousRoles.has(c.role) ? ' is-added' : ''}`}><header><Tag>{c.role}</Tag><span>{c.tokens} tokens（估算）{compare && !previousRoles.has(c.role) ? ' · 本轮新增' : ''}</span></header><p>{c.content}</p></article>)}
      <Alert type="info" title={run.dataSource ? '只展示本次记录的上下文；新增标记按角色比较，具体变化以消息内容为准。' : compare ? '本轮新增工具证据；原有 system、skill、user 消息未变化。' : '本次请求没有发生上下文压缩或裁剪。'} />
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={node.type === 'context' ? '请在输入输出中查看本次上下文装配与预算检查。' : '该节点没有独立模型上下文快照'} /> : null}
    {tab === 'usage' ? <>
      <Descriptions column={1} size="small" bordered items={[
        { key: 'provider', label: '供应商 / 模型', children: node.provider ? `${node.provider} / ${node.model}` : '不适用' },
        { key: 'in', label: '输入 Token', children: node.inputTokens?.toLocaleString() ?? (node.type === 'llm' ? '未知 · 未返回 usage' : '不适用') },
        { key: 'out', label: '输出 Token', children: node.outputTokens?.toLocaleString() ?? (node.type === 'llm' ? '未知' : '不适用') },
        { key: 'cache', label: '缓存读取', children: node.cachedTokens ? `${node.cachedTokens}（已包含在输入 Token）` : '未提供' },
        { key: 'cost', label: '费用', children: node.cost === null ? '待核价' : node.cost !== undefined ? `${node.currency === 'USD' ? '$' : '¥'}${node.cost.toFixed(5)} · 估算` : '无独立计费，关联子调用单独统计' },
        { key: 'price', label: '定价依据', children: node.cost != null ? (run.dataSource ? '本地调用无模型费用；外部调用未配置单价则待核价' : '演示定价 v2026.10 · 非供应商账单') : '无适用定价 / 未采集用量' },
      ]} />
      <p className="obs-note">根运行与 Skill 仅聚合子调用，不重复计费。失败调用无 usage 时，不能认定为零费用。</p>
    </> : null}
    {tab === 'events' ? <Timeline items={node.events.map((event, index) => ({ color: event.includes('failed') || event.includes('失败') ? 'red' : 'blue', content: <><small className="obs-muted">事件 {index + 1}</small><p>{event}</p></> }))} /> : null}
    {tab === 'raw' ? <JsonContent value={{ traceId: run.traceId, spanId: node.id, parentSpanId: node.parent ?? null, ...node }} query="" /> : null}
  </section>;
}

export function RunDetail({ run, onBack, onNavigate }: { run: ObsRun; onBack: () => void; onNavigate: (view: string, id?: string) => void }) {
  const [selectedId, setSelectedId] = useState(run.issueNode ?? run.nodes[0]?.id ?? '');
  const [nodeType, setNodeType] = useState('all');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [view, setView] = useState('journal');
  const u = usageOf(run);
  const selected = run.nodes.find(n => n.id === selectedId) ?? run.nodes[0];
  const visible = run.nodes.filter(n => (nodeType === 'all' || n.type === nodeType) && (!onlyErrors || n.status !== 'success'));
  const duration = Math.max(run.duration, ...run.nodes.map(n => n.start + n.duration));
  const depth = (n: TraceNode): number => n.parent ? 1 + (run.nodes.find(p => p.id === n.parent)?.parent ? 1 : 0) : 0;
  return <div className="obs-detail">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeftOutlined /> 返回列表 · 保留筛选</button>
    <header className="obs-detail-heading"><div><div className="subtle-label">RUN EXPLORER / {run.id}</div><h1>{run.name} <StatusTag status={run.status} /></h1><p>{run.input}</p></div><Space wrap><Tag>{run.dataSource === 'captured' ? '平台实际采集' : run.dataSource === 'reported' ? '执行器上报' : run.dataSource === 'historical' ? '历史记录 · 内部证据未采集' : '演示数据'}</Tag><Tag>{run.environment}</Tag>{run.kind !== 'build' ? <CaptureCaseButton run={run} /> : null}<Button icon={<FileSearchOutlined />} onClick={() => onNavigate('usage', run.id)}>查看费用</Button></Space></header>
    <div className="obs-run-summary">
      <div><small>开始时间</small><strong>{formatTime(run.startedAt)}</strong></div><div><small>端到端耗时</small><strong>{(run.duration / 1000).toFixed(2)}s</strong></div><div><small>已知 Token</small><strong>{(u.input + u.output).toLocaleString()}</strong></div><div><small>费用 · 估算</small><strong>{formatCost(run)}</strong></div><div><small>版本</small><strong>{run.version}{run.dataSource ? '' : ' / Harness v0.3'}</strong></div>
    </div>
    {view !== 'journal' ? <div className="obs-result"><span>最终输出</span><p>{run.output}</p>{run.sessionId ? <Button type="link" size="small" onClick={() => onNavigate('conversations', run.id)}>关联会话 {run.sessionId}</Button> : null}</div> : null}
    {run.issue && view !== 'journal' ? <Alert showIcon type={run.status === 'success' ? 'warning' : 'error'} title={`${run.issue}${run.status === 'success' ? ' · 重试后已恢复，保留异常记录' : ''}`} action={<Button size="small" onClick={() => { setSelectedId(run.issueNode ?? selectedId); setOnlyErrors(false); setNodeType('all'); }}>定位异常节点</Button>} /> : null}
    <div className="obs-trace-toolbar"><Space wrap>{view === 'journal' ? <><Tag color="purple">输入输出 / 完整执行过程</Tag>{run.issue ? <Tag color={run.status === 'success' ? 'orange' : 'red'}>{run.issue}</Tag> : null}</> : <><Select aria-label="筛选节点类型" value={nodeType} onChange={setNodeType} style={{ width: 150 }} options={[{ value: 'all', label: '全部节点' }, ...Object.entries(typeLabels).map(([value, label]) => ({ value, label }))]} /><Button type={onlyErrors ? 'primary' : 'default'} onClick={() => setOnlyErrors(v => !v)}>仅看异常</Button></>}</Space><Space><Button size="small" type={view === 'journal' ? 'primary' : 'default'} onClick={() => setView('journal')}>执行实录</Button><Button size="small" type={view === 'waterfall' ? 'primary' : 'default'} onClick={() => setView('waterfall')}>时间瀑布</Button><Button size="small" type={view === 'tree' ? 'primary' : 'default'} onClick={() => setView('tree')}>紧凑执行树</Button></Space></div>
    {view === 'journal' ? <ExecutionJournal run={run} /> : <div className={`obs-trace-layout${view === 'tree' ? ' is-compact' : ''}`}>
      <section className="obs-execution">
        <div className="obs-execution-title"><strong>执行树</strong><span>{view === 'waterfall' ? `0s — ${(duration / 1000).toFixed(1)}s` : '按执行开始顺序'}</span></div>
        {visible.length ? visible.map(n => <button key={n.id} type="button" aria-pressed={selected.id === n.id} className={`obs-trace-row${selected.id === n.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(n.id)}>
          <span className="obs-trace-node" style={{ paddingLeft: 12 + depth(n) * 15 }}><i className={`obs-status-dot obs-status-dot--${n.status}`} /><span><b>{n.name}</b><small>{typeLabels[n.type]}{n.attempt ? ` · attempt ${n.attempt}` : ''}</small></span></span>
          {view === 'waterfall' ? <span className="obs-waterfall"><i className={`obs-waterfall-bar obs-waterfall-bar--${n.type}${n.status === 'failed' ? ' is-failed' : ''}`} style={{ marginLeft: `${n.start / duration * 78}%`, width: `${Math.max(2, n.duration / duration * 78)}%` }} /><small>{(n.duration / 1000).toFixed(2)}s</small></span> : <StatusTag status={n.status} />}
        </button>) : <Empty description="没有符合条件的节点" />}
        <div className="obs-execution-footer"><span><i className="obs-legend-purple" /> 模型</span><span><i className="obs-legend-blue" /> 工具 / 检索</span><span><i className="obs-legend-orange" /> Skill / Harness</span></div>
      </section>
      <NodeInspector key={selected.id} node={selected} run={run} />
    </div>}
  </div>;
}
