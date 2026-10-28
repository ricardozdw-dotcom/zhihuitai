import { useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Select, Space, Tag } from 'antd';
import { ArrowDownOutlined, ArrowRightOutlined, CodeOutlined, DownOutlined, FileTextOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { buildJournal, codeForNode, journalLabels, type JournalEvent } from './journal-data';
import { statusMeta, typeLabels, type ObsRun, type TraceNode } from './data';
import './execution-journal.css';

function json(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '未采集';
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return <>{text.split(new RegExp(`(${escaped})`, 'gi')).map((part, i) => part.toLowerCase() === query.toLowerCase() ? <mark key={i}>{part}</mark> : part)}</>;
}

function CodeLine({ line }: { line: string }) {
  const pieces = line.split(/("[^"\n]*"|'[^'\n]*'|\b(?:async|await|def|return|if|raise|try|except|as|True|False|None)\b|\b\d+\b)/g);
  return <>{pieces.map((part, i) => <span key={i} className={/^["']/.test(part) ? 'journal-code-string' : /^(async|await|def|return|if|raise|try|except|as|True|False|None)$/.test(part) ? 'journal-code-keyword' : /^\d+$/.test(part) ? 'journal-code-number' : undefined}>{part}</span>)}</>;
}

function CodeExplorer({ node, expandInternals }: { node: TraceNode; expandInternals: boolean }) {
  const source = codeForNode(node);
  const [range, setRange] = useState<[number, number] | null>(null);
  return <div className="journal-code-explorer">
    <div className="journal-code-origin"><CodeOutlined /><div><strong>{source.path}</strong><span>{source.origin === 'captured' ? `实际采集源码 · revision ${source.revision}` : '演示实现 · 未实际执行，不代表后端当前源码'}</span></div><Tag color={source.origin === 'captured' ? 'green' : 'gold'}>{source.language}</Tag></div>
    <div className="journal-code-grid">
      <div className="journal-code-pane"><div className="journal-code-caption">SOURCE <span>{source.origin === 'captured' ? source.revision : 'EXAMPLE / READ ONLY'}</span></div><pre>{source.code.split('\n').map((line, i) => <div key={i} className={range && i + 1 >= range[0] && i + 1 <= range[1] ? 'is-highlighted' : ''}><span className="journal-line-number">{i + 1}</span><code><CodeLine line={line} /></code></div>)}</pre></div>
      <div className="journal-code-explanations"><div className="journal-code-caption">代码解释 <span>点击定位代码行</span></div>{source.explanation.length ? source.explanation.map((part, index) => <button type="button" className={range === part.lines ? 'is-active' : ''} key={index} onClick={() => setRange(part.lines)}><span>L{part.lines[0]}{part.lines[1] !== part.lines[0] ? `–${part.lines[1]}` : ''}</span><strong>{part.title}</strong><p>{part.detail}</p></button>) : <p className="obs-note">已采集源码，当前没有代码注释；不自动生成未经核对的执行解释。</p>}</div>
    </div>
    <details className="journal-variable-details" open={expandInternals}><summary>调用变量快照 · 参数与返回值</summary><div className="journal-variable-grid"><div><span>调用前 · 参数</span><pre>{json(node.input)}</pre></div><div><span>调用后 · 返回</span><pre>{json(node.output)}</pre></div></div><p>仅展示已记录的参数与返回值；局部变量、真实异常栈和执行行覆盖尚未采集，不据代码推算执行结果。</p></details>
  </div>;
}

function PlanBody({ value }: { value: unknown }) {
  if (!Array.isArray(value) || !value.every(step => step && typeof step === 'object' && typeof step.task === 'string' && (step.requires === undefined || Array.isArray(step.requires)))) return <pre className="journal-payload">{json(value)}</pre>;
  return <><div className="journal-plan-list">{value.map((step, i) => <div key={i}><span>{json(step.step ?? i + 1)}</span><div><strong>{step.task}</strong><small>{step.tool ? `动作：${json(step.tool)}` : `依赖：${step.requires?.join('、') ?? '无'}`}</small></div><Tag>公开计划声明</Tag>{i < value.length - 1 ? <ArrowDownOutlined /> : null}</div>)}</div><details><summary>完整 Plan 原文 · 保留所有字段</summary><pre className="journal-payload">{json(value)}</pre></details></>;
}

function EventBody({ event, query, expandInternals, recorded }: { event: JournalEvent; query: string; expandInternals: boolean; recorded: boolean }) {
  const node = event.node;
  const isRequest = event.id.endsWith(':start') && node?.type === 'llm';
  const request = isRequest ? event.payload as { messages?: Array<{ role: string; content: unknown }> } : null;
  const snapshot = node?.context;
  return <>
    {event.kind === 'plan' ? <PlanBody value={event.payload} /> : <>
      {request?.messages ? <div className="journal-messages"><div className="journal-field-title">本次模型请求消息 <span>{request.messages.length} 条 · 无界面截断</span></div>{request.messages.map((item, index) => <div className={`journal-message journal-message--${item.role}`} key={index}><header><Tag>{item.role}</Tag><span>message[{index}]</span></header><pre><HighlightText text={json(item.content)} query={query} /></pre></div>)}</div> : null}
      {snapshot && isRequest ? <div className="journal-context-attachment"><header><span>上下文组成 · 随请求携带</span><strong>{node.inputTokens?.toLocaleString() ?? '未知'} 输入 Token</strong></header><div>{snapshot.map((item, i) => <span key={i} style={{ flex: item.tokens }} className={`journal-context-part--${item.role}`}>{item.role}</span>)}</div><p>分项 Token 为字符估算；工具返回在下一轮消息中原样关联。展开下方原始快照可查看消息、工具定义及全部请求字段。</p></div> : null}
      {isRequest ? <details className="journal-request-raw" open={expandInternals}><summary>完整请求快照 · 消息、工具定义与参数</summary><pre className="journal-payload"><HighlightText text={json(event.payload)} query={query} /></pre></details> : <pre className={`journal-payload${event.kind === 'exception' ? ' journal-payload--error' : ''}`}><HighlightText text={json(event.payload)} query={query} /></pre>}
    </>}
    {node ? recorded && !node.executionSource ? <p className="obs-note">该节点未采集执行源码；输入输出和事件保留原始记录。</p> : <details className="journal-source-details" open={expandInternals}><summary><CodeOutlined /> 展开节点代码与解释 <span>{node.executionSource ? '实际源码' : '演示实现'}</span></summary><CodeExplorer node={node} expandInternals={expandInternals} /></details> : null}
  </>;
}

export function ExecutionJournal({ run }: { run: ObsRun }) {
  const events = useMemo(() => buildJournal(run), [run]);
  const [openEvents, setOpenEvents] = useState(() => new Set(events.map(e => e.id)));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [group, setGroup] = useState<'time' | 'round'>('time');
  const [selectedNode, setSelectedNode] = useState('');
  const [expandInternals, setExpandInternals] = useState(false);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const matching = events.filter(e => (kind === 'all' || e.kind === kind) && (!query || `${e.label} ${e.summary} ${e.nodeId ?? ''} ${json(e.payload)}`.toLowerCase().includes(query.toLowerCase())));
  const ordered = group === 'round' ? [...matching].sort((a, b) => a.round - b.round || a.time - b.time) : matching;
  const roundLabel = (round: number) => round === 0 ? '任务与 Skill 初始化' : round === 99 ? '任务结果' : `ReAct · 第 ${round} 轮`;
  const jump = (nodeId: string) => {
    setKind('all'); setQuery(''); setSelectedNode(nodeId);
    const target = events.find(e => e.nodeId === nodeId && e.kind === 'exception') ?? events.find(e => e.nodeId === nodeId);
    if (!target) return;
    setOpenEvents(current => new Set([...current, target.id]));
    // 清除筛选后，等待本次 React 提交再定位事件。
    window.requestAnimationFrame(() => refs.current[target.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const toggle = (id: string) => setOpenEvents(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const gaps = [
    ...(run.dataSource === 'historical' ? ['此历史日志未采集内部调用链、模型上下文或执行代码，只能查看当时保存的请求与结果。'] : []),
    ...(!run.dataSource && run.issue === 'MAX_ITERATIONS' ? ['循环样例只采集了末次迭代及轮数限制事件，早期迭代内容未采集，不能还原完整 12 轮。'] : []),
    ...(!run.dataSource && run.issue === 'CONTEXT_WINDOW_EXCEEDED' ? ['超限样例保留了 142,000 Token 的体积估算，但未采集该超长工具返回的完整正文；当前显示的是已记录证据。'] : []),
    ...(run.status === 'unknown' ? ['执行器终态未收到；当前实录停留在最后已知事件，不能证明后续执行结果。'] : []),
  ];
  return <section className="journal-workspace">
    <div className="journal-intro"><div><span className="subtle-label">EXECUTION JOURNAL</span><h2>一次任务，一份完整执行实录</h2><p>Plan、Action、Observation、上下文和异常，沿着同一条数据流展开。</p></div><div><strong>{events.length}</strong><span>已记录事件</span><Tag color="purple">{run.dataSource ? '运行证据记录' : '演示记录'}</Tag></div></div>
    <div className="journal-capture-note"><FileTextOutlined /><span>展示运行时可记录的公开计划、消息与执行事件。未采集的内容、内部思维、局部变量及源码不会补写为运行事实。</span></div>
    {gaps.length ? <div className="journal-data-gaps"><strong>采集缺口 · 本次记录不能视为完整运行</strong>{gaps.map(gap => <p key={gap}>{gap}</p>)}</div> : null}
    <div className="journal-layout">
      <aside className="journal-outline"><header><span>调用链 / 节点目录</span><small>{run.nodes.length} 个节点</small></header><button type="button" className="journal-outline-entry" onClick={() => refs.current['task-input']?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span className="journal-outline-glyph">IN</span><span><strong>任务输入</strong><small>使用者 → Agent</small></span></button>{run.nodes.filter(n => n.id !== 'root').sort((a,b) => a.start - b.start).map(node => <button key={node.id} type="button" className={`journal-outline-entry${selectedNode === node.id ? ' is-active' : ''}`} onClick={() => jump(node.id)} style={{ paddingLeft: node.parent && node.parent !== 'root' ? 29 : 14 }}><i className={`obs-status-dot obs-status-dot--${node.status}`} /><span><strong>{node.name}</strong><small>{typeLabels[node.type]} · {statusMeta[node.status].label}</small></span><span className="journal-outline-time">{(node.start / 1000).toFixed(2)}s</span></button>)}<div className="journal-outline-foot"><p>点击节点，定位其输入或异常事件。</p><span>trace / {run.traceId}</span></div></aside>
      <div className="journal-main">
        <div className="journal-toolbar"><Input prefix={<SearchOutlined />} aria-label="搜索完整执行实录" placeholder="搜索消息、参数、错误码或节点 ID" value={query} onChange={e => setQuery(e.target.value)} allowClear /><Select aria-label="筛选执行事件" value={kind} style={{ width: 145 }} onChange={setKind} options={[{ value: 'all', label: '全部事件' }, ...Object.entries(journalLabels).map(([value,label]) => ({ value, label }))]} /><Select aria-label="执行实录分组" value={group} style={{ width: 145 }} onChange={setGroup} options={[{ value: 'time', label: '按时间顺序' }, { value: 'round', label: '按 ReAct 轮次' }]} /><Space size={3}><Button size="small" type="text" onClick={() => { setOpenEvents(new Set(events.map(e => e.id))); setExpandInternals(true); }}>全部展开</Button><Button size="small" type="text" onClick={() => { setOpenEvents(new Set()); setExpandInternals(false); }}>全部折叠</Button></Space></div>
        <div className="journal-coverage"><span>{matching.length} / {events.length} 条事件</span><span>异常保留原位置 · 重试独立记录 · 无静默省略</span></div>
        {ordered.length ? ordered.map((event, index) => {
          const expanded = openEvents.has(event.id);
          const isNewGroup = group === 'round' && (index === 0 || ordered[index - 1].round !== event.round);
          return <div key={event.id}>{isNewGroup ? <div className="journal-round-divider"><span>{roundLabel(event.round)}</span><i /></div> : null}<article ref={element => { refs.current[event.id] = element; }} className={`journal-event journal-event--${event.kind}${selectedNode && event.nodeId === selectedNode ? ' is-selected' : ''}`}>
            <div className="journal-event-rail"><span>{events.findIndex(e => e.id === event.id) + 1}</span><i /></div>
            <div className="journal-event-card"><button type="button" className="journal-event-head" aria-expanded={expanded} onClick={() => toggle(event.id)}><span className={`journal-event-kind journal-event-kind--${event.kind}`}>{journalLabels[event.kind]}</span><div><strong>{event.label}</strong><small>{event.direction}{event.nodeId ? ` · ${event.nodeId}` : ''}{event.round > 0 && event.round < 99 ? ` · ReAct ${event.round}` : ''}</small></div><span className="journal-event-time">+{(event.time / 1000).toFixed(3)}s</span>{expanded ? <UpOutlined /> : <DownOutlined />}</button><div className="journal-event-summary">{event.summary}</div>
              {expanded ? <div className="journal-event-body"><EventBody event={event} query={query} expandInternals={expandInternals} recorded={Boolean(run.dataSource)} />{event.related?.length ? <div className="journal-related"><span>数据流向</span>{event.related.map(id => <Button key={id} size="small" type="link" onClick={() => jump(id)}>{id} <ArrowRightOutlined /></Button>)}</div> : null}<footer><span>{event.source}</span>{event.node?.inputTokens !== undefined && event.id.endsWith(':end') ? <span>{event.node.inputTokens} 输入 / {event.node.outputTokens ?? 0} 输出 Token</span> : null}</footer></div> : null}
            </div>
          </article></div>;
        }) : <Empty description="没有匹配的执行事件"><Button onClick={() => { setQuery(''); setKind('all'); }}>清除筛选</Button></Empty>}
      </div>
    </div>
  </section>;
}
