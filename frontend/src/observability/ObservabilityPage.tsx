import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LineChartOutlined, ArrowRightOutlined, ClockCircleOutlined, DownloadOutlined, DollarOutlined, FileSearchOutlined, ReloadOutlined, SettingOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, App, Button, Drawer, Empty, Input, InputNumber, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { PageHeader } from '../components/PageHeader';
import { usePrototype } from '../context/PrototypeContext';
import { RunDetail, StatusTag } from './RunDetail';
import { formatCost, formatTime, totalUsage, usageOf, type ObsRun, type TraceNode } from './data';
import { CaptureCaseButton } from '../evaluations/CaptureCaseButton';
import './observability.css';
import { apiEnabled } from '../api/client';
import { useObservedRuns } from './store';

const sections = [
  { key: 'overview', label: '观测总览', short: 'OVERVIEW' }, { key: 'builds', label: '知识库构建', short: 'BUILD PIPELINE' },
  { key: 'agents', label: 'Agent 运行', short: 'AGENT RUNS' }, { key: 'conversations', label: '对话日志', short: 'CONVERSATIONS' },
  { key: 'usage', label: '用量与费用', short: 'USAGE & COST' }, { key: 'exceptions', label: '异常中心', short: 'EXCEPTIONS' },
];
const issueLabels: Record<string, string> = {
  TOOL_TIMEOUT: '工具调用超时', CONTEXT_WINDOW_EXCEEDED: '上下文窗口超限',
  SKILL_DEPENDENCY_MISSING: 'Skill 执行依赖缺失', WORKER_HEARTBEAT_MISSING: 'Worker 心跳缺失',
  MAX_ITERATIONS: '达到最大执行轮数', OCR_QUOTA_EXCEEDED: 'OCR 额度不足',
};
type UsageRow = TraceNode & { run: ObsRun; key: string };

function Metric({ label, value, hint, tone = 'purple', icon }: { label: string; value: string; hint: string; tone?: string; icon: React.ReactNode }) {
  return <div className={`obs-metric obs-metric--${tone}`}><div><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{hint}</small></div>;
}

function Trend({ runs }: { runs: ObsRun[] }) {
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const end = Date.now() - (11 - index) * 2 * 3600000;
    const group = runs.filter(r => +new Date(r.startedAt) <= end && +new Date(r.startedAt) > end - 2 * 3600000);
    return { count: group.length, errors: group.filter(r => r.status === 'failed' || r.status === 'partial').length, label: new Date(end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) };
  });
  const max = Math.max(1, ...buckets.map(b => b.count));
  return <section className="obs-panel obs-trend"><header><div><h3>运行趋势</h3><p>最近 24 小时 · 每 2 小时聚合</p></div><div className="obs-chart-legend"><span><i />运行次数</span><span><i />异常终态</span></div></header><div className="obs-bar-chart">{buckets.map((b, i) => <Tooltip key={i} title={`${b.label}：${b.count} 次运行，${b.errors} 次失败/部分成功`}><div className="obs-chart-column"><div className="obs-chart-bars"><span style={{ height: `${Math.max(2, b.count / max * 100)}%` }} /><span style={{ height: `${Math.max(0, b.errors / max * 100)}%` }} /></div><small>{b.label}</small></div></Tooltip>)}</div></section>;
}

function downloadCsv(rows: UsageRow[]) {
  const safe = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [['运行 ID', '节点', '供应商', '模型', '输入 Token', '输出 Token', '币种', '估算金额', '费用状态'], ...rows.map(r => [r.run.id, r.name, r.provider, r.model, r.inputTokens ?? '未知/不适用', r.outputTokens ?? '未知/不适用', r.currency, r.cost ?? '未知', r.cost === null ? '待核价' : '演示估算'])].map(row => row.map(safe).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = '知汇台-演示用量费用.csv'; link.click(); URL.revokeObjectURL(url);
}

export default function ObservabilityPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { role } = usePrototype();
  const { view = 'overview', runId } = useParams();
  const { runs: obsRuns, loading, error, refresh } = useObservedRuns(runId);
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(false);
  const [priceSettings, setPriceSettings] = useState(false);
  const [retention, setRetention] = useState(90);
  const [captureMode, setCaptureMode] = useState('masked');
  const [threshold, setThreshold] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [updated, setUpdated] = useState(new Date().toLocaleTimeString('zh-CN'));
  const [triage, setTriage] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [issueRun, setIssueRun] = useState<ObsRun | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState('model');
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { refresh(); setUpdated(new Date().toLocaleTimeString('zh-CN')); }, 10000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);
  const manager = role === 'manager';
  const visibleSections = manager ? sections.filter(s => s.key === 'builds') : sections;
  const effectiveView = manager ? 'builds' : sections.some(s => s.key === view) ? view : 'overview';
  const keyword = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const time = params.get('time') ?? '24';
  const environment = params.get('env') ?? 'all';
  const knowledge = params.get('kb') ?? 'all';
  const provider = params.get('provider') ?? 'all';
  const focus = params.get('focus');
  const session = params.get('session');
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === 'all') next.delete(key); else next.set(key, value); setParams(next, { replace: true }); };
  const go = (target: string, id?: string) => {
    const next = new URLSearchParams(params);
    next.delete('focus'); next.delete('session');
    if (target === 'usage' && id) { next.set('focus', id); navigate(`/observability/usage?${next}`); }
    else if (target === 'conversations' && id) { const run = obsRuns.find(r => r.id === id); if (run?.sessionId) next.set('session', run.sessionId); navigate(`/observability/conversations?${next}`); }
    else navigate(`/observability/${target}${id ? `/${id}` : ''}?${next}`);
  };
  const filtered = obsRuns.filter(r => {
    if (manager && r.kind !== 'build') return false;
    const haystack = [r.name, r.id, r.traceId, r.input, r.output, r.knowledge, r.issue, ...r.nodes.map(n => `${n.name} ${n.provider ?? ''} ${n.model ?? ''}`)].join(' ').toLowerCase();
    return (!keyword || haystack.includes(keyword.toLowerCase())) && (status === 'all' || r.status === status) && (environment === 'all' || r.environment === environment) && (knowledge === 'all' || r.knowledge === knowledge) && (provider === 'all' || r.nodes.some(n => n.provider === provider)) && Date.now() - +new Date(r.startedAt) <= Number(time) * 3600000;
  });
  const runs = filtered.filter(r => effectiveView === 'agents' ? r.kind === 'agent' : effectiveView === 'builds' ? r.kind === 'build' : effectiveView === 'conversations' ? (r.kind === 'chat' || Boolean(r.sessionId)) && (!session || r.sessionId === session) : true).sort((a, b) => effectiveView === 'conversations' ? Number(b.kind === 'chat') - Number(a.kind === 'chat') || +new Date(b.startedAt) - +new Date(a.startedAt) : 0);
  const usage = totalUsage(runs);
  const failed = runs.filter(r => r.status === 'failed' || r.status === 'partial');
  const terminal = runs.filter(r => ['success', 'partial', 'failed'].includes(r.status));
  const durations = terminal.map(r => r.duration).sort((a, b) => a - b);
  const percentile = (p: number) => durations.length ? `${(durations[Math.max(0, Math.ceil(durations.length * p) - 1)] / 1000).toFixed(2)}s` : '—';
  const successRate = terminal.length ? `${Math.round(terminal.filter(r => r.status === 'success').length / terminal.length * 100)}%` : '—';
  const selected = runId ? obsRuns.find(r => r.id === runId && (!manager || r.kind === 'build')) : undefined;
  const detailTarget = (r: ObsRun) => go(r.kind === 'build' ? 'builds' : r.kind === 'chat' ? 'conversations' : 'agents', r.id);
  const usageRows: UsageRow[] = filtered.filter(r => !focus || r.id === focus).flatMap(run => run.nodes.filter(n => n.cost !== undefined || n.type === 'llm').map(n => ({ ...n, run, key: `${run.id}/${n.id}` })));
  const usageTotal = totalUsage(filtered.filter(r => !focus || r.id === focus));
  const groups = usageRows.reduce<Record<string, { count: number; tokens: number; cny: number; usd: number; unknown: number }>>((acc, r) => {
    const name = groupBy === 'provider' ? r.provider ?? '其他' : groupBy === 'application' ? r.run.name : groupBy === 'knowledge' ? r.run.kind === 'build' ? r.run.knowledge : '在线请求（关联知识库，不重复分摊）' : r.model ?? '其他';
    const row = acc[name] ?? { count: 0, tokens: 0, cny: 0, usd: 0, unknown: 0 };
    row.count++; row.tokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0); row.cny += r.currency === 'CNY' ? r.cost ?? 0 : 0; row.usd += r.currency === 'USD' ? r.cost ?? 0 : 0; row.unknown += r.cost === null ? 1 : 0; acc[name] = row; return acc;
  }, {});

  const columns: TableColumnsType<ObsRun> = [
    { title: '运行 / 任务', key: 'name', width: 280, render: (_, r) => <button type="button" className="obs-link-cell" onClick={() => detailTarget(r)}><strong>{r.name}</strong><small>{r.id} · {r.version}</small></button> },
    { title: '输入摘要', dataIndex: 'input', ellipsis: true, width: 260 },
    { title: '状态', key: 'status', width: 145, render: (_, r) => <StatusTag status={r.status} /> },
    { title: 'Token', key: 'tokens', width: 100, render: (_, r) => { const u = usageOf(r); return <span className="numeric">{r.dataSource === 'historical' || u.tokenUnknown ? '未采集 / 未知' : (u.input + u.output).toLocaleString()}</span>; } },
    { title: '费用 · 估算', key: 'cost', width: 145, render: (_, r) => <button type="button" className="obs-text-link numeric" onClick={() => go('usage', r.id)}>{formatCost(r)}</button> },
    { title: '耗时', dataIndex: 'duration', width: 85, sorter: (a, b) => a.duration - b.duration, render: (d: number) => `${(d / 1000).toFixed(2)}s` },
    { title: '开始时间', dataIndex: 'startedAt', width: 125, sorter: (a, b) => +new Date(a.startedAt) - +new Date(b.startedAt), render: formatTime },
    { title: 'Case 回流', key: 'capture', width: 115, fixed: 'right', render: (_, r) => r.kind !== 'build' ? <CaptureCaseButton run={r} compact /> : '—' },
  ];
  const buildColumns: TableColumnsType<ObsRun> = [columns[0],
    { title: '知识库 / 版本', key: 'kb', width: 210, render: (_, r) => <div>{r.knowledge}<small className="obs-subtext">{r.version}</small></div> },
    { title: '文件 / 阶段', key: 'file', width: 200, render: (_, r) => <div>{r.status === 'partial' ? '2 成功 / 1 失败' : '3 / 3 已发布'}<small className="obs-subtext">86 分块 · 索引已发布</small></div> },
    columns[2], columns[4], columns[5],
  ];

  if (runId && loading) return <div className="app-page"><Alert type="info" title="正在加载运行记录" /></div>;
  if (runId && error) return <div className="app-page"><Alert type="error" title={error} action={<Button onClick={refresh}>重试</Button>} /></div>;
  if (runId) return <div className="app-page obs-page">{selected ? <RunDetail key={selected.id} run={selected} onBack={() => navigate(`/observability/${effectiveView}?${params}`)} onNavigate={go} /> : <Empty description="找不到该运行或当前角色不可见"><Button onClick={() => go(effectiveView)}>返回列表</Button></Empty>}</div>;

  const renderOverview = () => <>
    <div className="obs-overview-grid"><Trend runs={runs} /><section className="obs-panel obs-health"><header><div><h3>链路采集健康</h3><p>让未知可见，保留数据边界</p></div><span className="obs-health-icon">◎</span></header><div className="obs-health-score"><strong>{runs.filter(r => r.status !== 'unknown' && !usageOf(r).unknown).length}<small> / {runs.length}</small></strong><span>终态已知且无待核价调用的记录</span></div><div className="obs-health-item"><span>心跳缺失</span><b>{runs.filter(r => r.status === 'unknown').length} 条</b></div><div className="obs-health-item"><span>usage 缺失 / 待核价</span><b>{usage.unknown} 次调用</b></div><div className="obs-health-item"><span>事件来源</span><Tag color="purple">{apiEnabled ? "平台采集 / 执行器上报" : "前端演示"}</Tag></div></section></div>
    <div className="obs-overview-grid"><section className="obs-panel"><header><div><h3>需要关注</h3><p>保留已恢复异常，也展示未结束任务</p></div><Button type="link" onClick={() => go('exceptions')}>全部异常 <ArrowRightOutlined /></Button></header><div className="obs-issue-list">{runs.filter(r => r.issue).slice(0, 4).map(r => <button key={r.id} type="button" onClick={() => detailTarget(r)}><i className={`obs-status-dot obs-status-dot--${r.status}`} /><div><strong>{issueLabels[r.issue!] ?? r.issue}</strong><small>{r.name} · {r.id}</small></div><StatusTag status={r.status} /><ArrowRightOutlined /></button>)}{!runs.some(r => r.issue) ? <Empty description="当前范围没有异常" /> : null}</div></section><section className="obs-panel"><header><div><h3>消耗较高的运行</h3><p>按人民币估算费用排序 · 美元单列</p></div><Button type="link" onClick={() => go('usage')}>用量明细</Button></header><div className="obs-cost-ranking">{[...runs].sort((a, b) => usageOf(b).cny - usageOf(a).cny).slice(0, 4).map((r, i) => <button type="button" key={r.id} onClick={() => go('usage', r.id)}><span>{i + 1}</span><div><strong>{r.name}</strong><small>{r.id}</small></div><b>{formatCost(r)}</b></button>)}</div></section></div>
    <section className="obs-panel"><header><div><h3>最近运行</h3><p>构建、Agent 与对话的统一入口</p></div><Tag>{runs.length} 条运行</Tag></header><Table rowKey="id" columns={columns} dataSource={runs.slice(0, 5)} pagination={false} scroll={{ x: 1200 }} /></section>
  </>;

  const renderUsage = () => <>
    <div className="obs-usage-banner"><div><span>已知费用</span><strong>¥{usageTotal.cny.toFixed(4)} <small>+ ${usageTotal.usd.toFixed(4)}</small></strong><p>原币展示，不自动换汇；另有 {usageTotal.unknown} 次待核价调用。</p></div><div><span>已知输入 / 输出</span><strong>{usageTotal.input.toLocaleString()} <small>/ {usageTotal.output.toLocaleString()}</small></strong><p>缓存读取 {usageTotal.cached.toLocaleString()} 已包含在输入中</p></div><Space><Button onClick={() => setPriceSettings(true)}>查看计价依据</Button><Button icon={<DownloadOutlined />} onClick={() => downloadCsv(usageRows)}>导出明细</Button></Space></div>
    <section className="obs-panel"><header><div><h3>费用归因</h3><p>仅累加实际计费节点；父节点聚合不重复计费</p></div><Select value={groupBy} onChange={setGroupBy} style={{ width: 160 }} options={[{ value: 'model', label: '按模型' }, { value: 'provider', label: '按供应商' }, { value: 'application', label: '按应用' }, { value: 'knowledge', label: '按知识库/请求' }]} /></header><Table rowKey="name" size="middle" dataSource={Object.entries(groups).map(([name, values]) => ({ name, ...values }))} pagination={false} columns={[{ title: '归因对象', dataIndex: 'name' }, { title: '计费调用', dataIndex: 'count' }, { title: '已知 Token', dataIndex: 'tokens', render: (v: number) => v.toLocaleString() }, { title: '人民币估算', dataIndex: 'cny', render: (v: number) => `¥${v.toFixed(4)}` }, { title: '美元估算', dataIndex: 'usd', render: (v: number) => `$${v.toFixed(4)}` }, { title: '待核价', dataIndex: 'unknown' }]} /></section>
    <section className="obs-panel"><header><div><h3>调用级费用明细</h3><p>以实际调用记录为准；未返回 usage 或未配置单价时保留未知</p></div></header><Table<UsageRow> rowKey="key" dataSource={usageRows} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 1100 }} columns={[
      { title: '调用 / 运行', width: 230, render: (_, r) => <button className="obs-link-cell" type="button" onClick={() => detailTarget(r.run)}><strong>{r.name}</strong><small>{r.run.id}</small></button> },
      { title: '供应商 / 模型', width: 210, render: (_, r) => <div>{r.provider}<small className="obs-subtext">{r.model}</small></div> },
      { title: '用量', width: 190, render: (_, r) => r.inputTokens !== undefined ? `${r.inputTokens.toLocaleString()} 输入 / ${r.outputTokens ?? 0} 输出` : r.cost === null ? '未知 · usage 缺失' : apiEnabled ? r.tokenSource === 'none' ? '未调用外部模型' : '未采集 usage' : r.run.kind === 'build' ? `${Math.round((r.cost ?? 0) / .03)} 页 × ¥0.03（演示）` : '1 次（演示）' },
      { title: '金额', width: 140, render: (_, r) => r.cost === null ? <Tag color="orange">待核价</Tag> : `${r.currency === 'USD' ? '$' : '¥'}${(r.cost ?? 0).toFixed(5)}` },
      { title: '来源', render: (_, r) => <Tag>{apiEnabled ? r.tokenSource === "provider" ? "供应商 usage" : r.tokenSource === "none" ? "未调用外部模型" : "未采集 usage" : "演示估算 · v2026.10"}</Tag> },
    ]} /></section>
  </>;

  const renderExceptions = () => <section className="obs-panel"><header><div><h3>异常事件</h3><p>按运行记录展示异常；处理状态不改变原始结果</p>{apiEnabled ? <p>原始异常已持久保存；处理状态与备注仍仅保留在当前页面会话。</p> : null}</div><Tag>{runs.filter(r => r.issue).length} 条异常</Tag></header><Table<ObsRun> rowKey="id" dataSource={runs.filter(r => r.issue)} pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} columns={[
    { title: '异常 / 错误码', width: 340, render: (_, r) => <button type="button" className="obs-link-cell" onClick={() => detailTarget(r)}><strong>{issueLabels[r.issue!] ?? r.issue}</strong><small>{r.issue}</small></button> },
    { title: '影响运行', width: 150, render: (_, r) => r.id }, { title: '次数', width: 70, render: () => 1 },
    { title: '最终状态', width: 145, render: (_, r) => <StatusTag status={r.status} /> },
    { title: '处理状态', width: 140, render: (_, r) => <Select aria-label={`${r.id}处理状态`} value={triage[r.id] ?? '待处理'} onChange={value => setTriage(current => ({ ...current, [r.id]: value }))} options={['待处理', '排查中', '已解决', '忽略'].map(value => ({ value, label: value }))} /> },
    { title: '处理记录', render: (_, r) => <Button type="link" onClick={() => { setIssueRun(r); setNote(notes[r.id] ?? ''); }}>{notes[r.id] ? '查看备注' : '添加备注'}</Button> },
  ]} /></section>;

  return <div className="app-page obs-page">
    <PageHeader eyebrow="OBSERVABILITY / 知汇台" title="可观测中心" description="从知识构建到 Agent 执行，让每一次调用有迹可循。" actions={<Space><Tag color={apiEnabled ? "green" : "purple"}>{apiEnabled ? "真实运行记录" : "演示数据"}</Tag><Button icon={<ReloadOutlined />} onClick={() => { refresh(); setUpdated(new Date().toLocaleTimeString('zh-CN')); }}>刷新</Button>{!manager && !apiEnabled ? <Button icon={<SettingOutlined />} onClick={() => setSettings(true)}>观测设置</Button> : null}</Space>} />
    <div className="obs-demo-strip"><span><i />{apiEnabled ? "服务端采集空间" : "前端演示空间"} <b>LOCAL</b></span><span>{apiEnabled ? "实际采集 / 执行器上报 / 历史记录" : "样例随页面加载生成"} · Asia/Shanghai · 更新于 {updated}</span></div>
    {error ? <Alert type="error" showIcon title="运行日志加载失败" description={error} action={<Button onClick={refresh}>重试</Button>} /> : null}
    <nav className="obs-tabs" aria-label="可观测模块导航">{visibleSections.map(s => <button key={s.key} type="button" className={effectiveView === s.key ? 'is-active' : ''} onClick={() => go(s.key)}>{s.label}{s.key === 'exceptions' ? <span>{obsRuns.filter(r => r.issue).length}</span> : null}</button>)}</nav>
    <div className="obs-filters"><Input aria-label="搜索观测记录" placeholder="搜索运行、Trace、输入输出、文件或 Skill" value={keyword} onChange={e => setFilter('q', e.target.value)} prefix={<FileSearchOutlined />} allowClear /><Select aria-label="观测时间范围" value={time} onChange={value => setFilter('time', value)} options={[{ value: '24', label: '最近 24 小时' }, { value: '72', label: '最近 3 天' }, { value: '168', label: '最近 7 天' }]} /><Select aria-label="观测环境" value={environment} onChange={v => setFilter('env', v)} options={[{ value: 'all', label: '全部环境' }, { value: 'local', label: 'Local' }, { value: 'staging', label: 'Staging' }]} /><Select aria-label="知识库筛选" value={knowledge} onChange={v => setFilter('kb', v)} options={[{ value: 'all', label: '全部知识库' }, ...[...new Set(obsRuns.map(r => r.knowledge))].filter(Boolean).map(value => ({ value, label: value }))]} /><Select aria-label="观测状态" value={status} onChange={v => setFilter('status', v)} options={[{ value: 'all', label: '全部状态' }, ...Object.entries({ success: '成功', failed: '失败', partial: '部分成功', unknown: '未知', waiting: '等待人工' }).map(([value, label]) => ({ value, label }))]} /><Select aria-label="供应商筛选" value={provider} onChange={v => setFilter('provider', v)} options={[{ value: 'all', label: '全部供应商' }, ...[...new Set(obsRuns.flatMap(r => r.nodes.map(n => n.provider)))].filter((v): v is string => Boolean(v)).map(value => ({ value, label: value }))]} /><Button type="text" onClick={() => setParams({})}>重置</Button></div>
    {focus || session ? <div className="obs-focus"><span>已定位：{focus ?? session}</span><Button size="small" type="link" onClick={() => { const next = new URLSearchParams(params); next.delete('focus'); next.delete('session'); setParams(next); }}>查看全部</Button></div> : null}
    {manager ? <Alert showIcon type="info" title="知识库管理人员视图 · 当前仅展示构建记录；角色选择不代表真实权限隔离。" /> : null}
    {effectiveView !== 'usage' ? <div className="obs-metrics">
      <Metric icon={<LineChartOutlined />} label="范围内运行" value={String(runs.length)} hint={`${terminal.length} 条已结束 · 其余单独统计`} />
      <Metric icon={<ThunderboltOutlined />} label="执行成功率" value={successRate} hint={`${failed.length} 条失败或部分成功 · 不代表回答质量`} tone="green" />
      <Metric icon={<ClockCircleOutlined />} label="P95 / P50 耗时" value={`${percentile(.95)} / ${percentile(.5)}`} hint="仅统计成功、部分成功与失败终态" tone="blue" />
      <Metric icon={<DollarOutlined />} label="已知费用 · 估算" value={`¥${usage.cny.toFixed(4)}`} hint={`另 $${usage.usd.toFixed(4)} · ${usage.unknown} 次待核价`} tone="orange" />
    </div> : null}
    {effectiveView === 'overview' ? renderOverview() : null}
    {effectiveView === 'usage' ? renderUsage() : null}
    {effectiveView === 'exceptions' ? renderExceptions() : null}
    {['agents', 'builds', 'conversations'].includes(effectiveView) ? <>
      <div className="obs-section-heading"><div><span className="subtle-label">{sections.find(s => s.key === effectiveView)?.short}</span><h2>{effectiveView === 'builds' ? '构建批次' : effectiveView === 'agents' ? '每一次 Agent 执行，都能还原' : '从会话到单轮请求'}</h2><p>{effectiveView === 'builds' ? '上传不等于可检索。下钻文件、解析与索引发布阶段。' : effectiveView === 'agents' ? '检查输入输出、工具、Skill、上下文，以及 Harness 执行事件。' : '按会话聚合轮次，关联检索证据与 Agent 执行；拒答与失败分别记录。'}</p></div><Tag>{runs.length} 条运行</Tag></div>
      {effectiveView === 'agents' ? <div className="obs-quick-filters"><span>快速排查</span>{[{ label: '全部 Agent', value: 'all' }, { label: '执行失败', value: 'failed' }, { label: '等待人工', value: 'waiting' }, { label: '心跳缺失', value: 'unknown' }].map(item => <Button key={item.value} size="small" type={status === item.value ? 'primary' : 'default'} onClick={() => setFilter('status', item.value)}>{item.label}</Button>)}</div> : null}
      {effectiveView === 'conversations' ? <div className="obs-session-grid">{[...new Set(runs.map(r => r.sessionId).filter((id): id is string => Boolean(id)))].slice(0, 6).map(id => { const rounds = runs.filter(r => r.sessionId === id); return <button type="button" key={id} onClick={() => setFilter('session', id ?? '')}><span>会话 · {id}</span><strong>{rounds[0].name}</strong><small>{rounds.length} 轮 · {totalUsage(rounds).input + totalUsage(rounds).output} 已知 Token</small><ArrowRightOutlined /></button>; })}</div> : null}
      <section className="obs-panel"><Table<ObsRun> rowKey="id" loading={loading} columns={effectiveView === 'builds' ? buildColumns : effectiveView === 'conversations' ? [columns[0], columns[1], { title: '回答结果 / 反馈', width: 260, render: (_, r) => <div className="obs-answer-summary">{r.output}<small>{r.feedback ?? '暂无反馈'}</small></div> }, ...columns.slice(2)] : columns} dataSource={runs} pagination={{ pageSize: 8, showSizeChanger: false, showTotal: total => `共 ${total} 条运行` }} scroll={{ x: 1150 }} locale={{ emptyText: <Empty description="当前筛选下没有记录"><Button onClick={() => setParams({})}>重置筛选</Button></Empty> }} expandable={effectiveView === 'builds' ? { expandedRowRender: r => <div className="obs-file-list">{(apiEnabled ? [r.input] : ['员工手册.pdf', '远程办公制度.docx', '扫描附件.pdf']).map((name, index) => <div key={name}><FileSearchOutlined /><strong>{r.knowledge === '产品手册库' ? name.replace('员工', '产品').replace('远程办公制度', '产品说明') : name}</strong><Tag color={r.status === 'partial' && index === 2 ? 'red' : 'green'}>{apiEnabled ? r.status === 'success' ? '构建成功 · 可检索' : r.status === 'failed' ? '构建失败' : '构建中 / 未完成' : r.status === 'partial' && index === 2 ? 'OCR 失败 · 第 23–24 页' : '索引已发布 · 可检索'}</Tag><Button size="small" type="link" onClick={() => detailTarget(r)}>查看阶段详情</Button></div>)}</div> } : undefined} /></section>
    </> : null}
    <footer className="obs-footer"><span>TRACE / METRICS / COST</span><span>{apiEnabled ? '平台运行记录持久化 · 外部调用费用未配置单价时待核价 · 尚未启用自动过期清理' : `所有金额为演示估算 · 原始凭据不进入日志 · 保留期 ${retention} 天`}</span></footer>

    <Drawer title="观测设置 · 原型配置" open={settings} onClose={() => setSettings(false)} width={460} extra={<Button type="primary" onClick={() => { setSettings(false); void message.success('演示设置已保存在当前页面会话'); }}>保存</Button>}><Alert type="info" showIcon title="此处修改演示展示配置，尚未接入真实采集器和告警。" /><div className="obs-settings-form"><label><span>日志保留天数</span><InputNumber min={1} max={365} value={retention} onChange={v => setRetention(v ?? 90)} /></label><label><span>正文采集模式</span><Select value={captureMode} onChange={setCaptureMode} options={[{ value: 'metrics', label: '仅指标' }, { value: 'masked', label: '脱敏内容（推荐）' }, { value: 'full', label: '完整业务内容（仍排除凭据）' }]} /></label><label><span>费用预警阈值 · ¥ / 日</span><InputNumber min={1} value={threshold} onChange={v => setThreshold(v ?? 50)} /></label><label><span>自动刷新模式</span><Switch checked={autoRefresh} onChange={setAutoRefresh} /></label><p>演示数据固定，不会产生新的运行。真实接入后，自动刷新仅更新运行中记录；预警不会自动停用 Agent。</p><Alert type="warning" title="API Key、Cookie、Authorization 等凭据始终排除；角色视图不提供真实安全隔离。" /></div></Drawer>
    <Drawer title={apiEnabled ? '计价依据' : '计价依据 · 演示定价 v2026.10'} open={priceSettings} onClose={() => setPriceSettings(false)} width={520}>{!apiEnabled ? <Alert type="warning" showIcon title="以下仅用于验证原型计算，不代表供应商现行价格。" /> : null}{apiEnabled ? <p>尚未配置供应商单价。Token 以供应商 usage 为准；费用保留待核价。本地摘录与哈希向量未产生模型费用。</p> : <div className="obs-price-list"><p>模型：qwen-plus</p><p>输入 ¥0.8 / 百万 Token；输出 ¥2 / 百万 Token。缓存 600 Token 是输入子项，演示不另计一次费用。</p><p>Embedding：¥0.5 / 百万输入 Token。</p><p>Rerank：¥0.0003 / 次（演示）。</p><p>OCR：¥0.03 / 已处理页。已失败且未处理的页面不计入这笔演示金额。</p><p>OpenRouter：保留美元演示金额；不与人民币直接相加。</p><p>AIHubMix 样例未返回 usage，显示待核价，不按零费用处理。</p></div>}</Drawer>
    <Drawer title="异常处理记录" open={Boolean(issueRun)} onClose={() => setIssueRun(null)} width={480} extra={<Button type="primary" onClick={() => { if (issueRun) setNotes(current => ({ ...current, [issueRun.id]: note })); setIssueRun(null); void message.success('备注已保存在演示会话'); }}>保存备注</Button>}><Tag>{issueRun?.issue}</Tag><p>{issueRun?.id}</p><Input.TextArea aria-label="异常处理备注" value={note} onChange={e => setNote(e.target.value)} rows={7} placeholder="记录排查依据、影响范围和处理进展" /></Drawer>
  </div>;
}
