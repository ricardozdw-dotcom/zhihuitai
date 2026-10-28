import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App, Alert, Button, Drawer, Empty, Form, Input, Modal, Radio, Select, Space, Spin, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined, DownloadOutlined, ExperimentOutlined, FolderOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { ExecutionJournal } from '../observability/ExecutionJournal';
import { formatTime } from '../observability/data';
import { annotationReady, bulkAddCases, createDataset, refreshEvaluations, updateCase, useEvaluationStore, type CaseLabel, type EvaluationCase } from './store';
import { apiEnabled } from '../api/client';
import './evaluations.css';

const labels: Record<CaseLabel, { name: string; color: string }> = {
  goodcase: { name: 'Goodcase', color: 'green' }, badcase: { name: 'Badcase', color: 'volcano' }, unlabeled: { name: '待标注', color: 'default' },
};
function CaseTag({ label }: { label: CaseLabel }) { return <Tag color={labels[label].color}>{labels[label].name}</Tag>; }
function exportCases(cases: EvaluationCase[], datasets: ReturnType<typeof useEvaluationStore>['datasets']) {
  const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), dataMode: apiEnabled ? 'server-captured' : 'prototype-demo', datasets, cases };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `知汇台-评测集-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
}

function CaseReview({ item, onBack }: { item: EvaluationCase; onBack: () => void }) {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const store = useEvaluationStore();
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(item.revision);
  const [tab, setTab] = useState('annotation');
  const back = () => {
    if (!dirty) { onBack(); return; }
    modal.confirm({ title: '标注尚未保存', content: '返回列表将放弃本次未保存的标注修改。', okText: '放弃并返回', cancelText: '继续编辑', onOk: onBack });
  };
  const save = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const updated = await updateCase(item.id, { ...values, reason: (values.reason ?? '').trim(), expectedAnswer: (values.expectedAnswer ?? '').trim(), tags: values.tags ?? [] }, revision);
      setRevision(updated.revision);
      setDirty(false); void message.success('标注已保存；原始运行快照保持不变');
    } catch (error) { if (error instanceof Error) void message.error(error.name === 'QuotaExceededError' ? '存储空间不足，请先导出备份' : error.message); }
    finally { setSaving(false); }
  };
  return <>
    <button type="button" className="back-link" onClick={back}><ArrowLeftOutlined /> 返回评测集</button>
    <PageHeader eyebrow={`EVALUATION CASE / ${item.id}`} title="Case 标注与执行快照" description="标注可持续完善，来源请求与回流时的输入输出保持独立。" actions={<Space><CaseTag label={item.label} /><Button onClick={() => navigate(item.sourceUrl)}>打开来源日志 <ArrowRightOutlined /></Button><Button type="primary" loading={saving} onClick={() => void save()} disabled={tab !== 'annotation'}>保存标注</Button></Space>} />
    <div className="eval-case-meta"><span>来源 {item.sourceKind === 'chat' ? '对话日志' : 'Agent 运行'} · {item.sourceRunId}</span><span>回流于 {formatTime(item.createdAt)}</span><span>更新于 {formatTime(item.updatedAt)}</span><Tag color="purple">{apiEnabled ? '服务端不可变快照' : '演示日志快照'}</Tag></div>
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'annotation', label: '人工标注', forceRender: true, children: <div className="eval-review-layout">
        <section className="eval-panel"><header><div><h3>原始输入与实际输出</h3><p>回流时保存 · 不随来源日志刷新而变化</p></div><Tag>只读快照</Tag></header><div className="eval-snapshot-body"><span className="eval-field-caption">INPUT / 用户任务</span><pre>{item.snapshot.input}</pre><span className="eval-field-caption">ACTUAL OUTPUT / 实际结果</span><pre>{item.snapshot.output}</pre><div className="eval-source-facts"><span>Trace <b>{item.sourceTraceId}</b></span><span>应用 / 版本 <b>{item.snapshot.name} · {item.snapshot.version}</b></span><span>关联知识库 <b>{item.snapshot.knowledge}</b></span><span>快照节点 <b>{item.snapshot.nodes.length} 个</b></span></div><Button block onClick={() => setTab('snapshot')}>查看输入输出、Plan、工具与异常实录</Button></div></section>
        <section className="eval-panel"><header><div><h3>人工判断与参考标准</h3><p>Goodcase / Badcase 是人工分类，不等同于执行成功 / 失败。</p></div></header><div className="eval-annotation-form"><Form form={form} layout="vertical" initialValues={{ label: item.label, reason: item.reason, expectedAnswer: item.expectedAnswer, tags: item.tags, datasetIds: item.datasetIds }} onValuesChange={() => setDirty(true)}>
          <Form.Item name="label" label="Case 分类"><Radio.Group options={[{ value: 'goodcase', label: 'Goodcase' }, { value: 'badcase', label: 'Badcase' }, { value: 'unlabeled', label: '待标注' }]} /></Form.Item>
          <Form.Item name="reason" label="分类原因 / 问题说明"><Input.TextArea aria-label="Case 标注原因" rows={3} maxLength={4000} showCount placeholder="说明为什么值得保留，或哪里需要改进" /></Form.Item>
          <Form.Item name="expectedAnswer" label="期望答案 / 验收要点"><Input.TextArea aria-label="Case 期望答案" rows={5} maxLength={12000} showCount placeholder="人工补充正确答案、应调用的工具、引用要求或允许的拒答边界" /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',', '，']} placeholder="输入后回车添加" /></Form.Item>
          <Form.Item name="datasetIds" label="所属评测集" rules={[{ required: true, message: '至少保留一个评测集' }]}><Select mode="multiple" options={store.datasets.map(d => ({ value: d.id, label: d.name }))} /></Form.Item>
          <Alert showIcon type="info" title="分类、原因和期望答案齐全时，样本标记为“已完善”；本模块暂不执行自动评测。" />
        </Form></div></section>
      </div> },
      { key: 'snapshot', label: `执行快照 · ${item.snapshot.nodes.length} 节点`, children: <><Alert style={{ marginBottom: 18 }} showIcon type="info" title="此处读取 Case 保存的快照，不重新请求或执行 Agent。原日志变化、过期或不可用时，已保存快照仍可查看。" /><ExecutionJournal key={item.id} run={item.snapshot} /></> },
    ]} />
  </>;
}

export default function EvaluationsPage() {
  const store = useEvaluationStore();
  const { datasetId, caseId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkTarget, setBulkTarget] = useState<string>();
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = () => { void refreshEvaluations(true).catch((e: unknown) => void message.error(e instanceof Error ? e.message : '加载失败')); };
  const addDataset = async () => {
    setBusy(true);
    try { const dataset = await createDataset(name, description); setCreating(false); chooseDataset(dataset.id); void message.success('评测集已创建'); }
    catch (error) { void message.error(error instanceof Error ? error.message : '创建失败'); }
    finally { setBusy(false); }
  };
  const collect = async () => {
    if (!bulkTarget) return;
    setBusy(true);
    try { await bulkAddCases(selected, bulkTarget); setSelected([]); void message.success('已加入目标评测集'); }
    catch (error) { void message.error(error instanceof Error ? error.message : '归集失败'); }
    finally { setBusy(false); }
  };
  const currentDataset = store.datasets.find(d => d.id === datasetId);
  const label = params.get('label') ?? 'all';
  const query = params.get('q') ?? '';
  const completion = params.get('completion') ?? 'all';
  const time = params.get('time') ?? 'all';
  const filtered = store.cases.filter(c => {
    const date = new Date(c.createdAt);
    const inDate = time === 'today' ? date.toDateString() === new Date().toDateString() : time === 'week' ? Date.now() - +date <= 7 * 86400000 : true;
    return (!datasetId || c.datasetIds.includes(datasetId)) && (label === 'all' || label === c.label) && (completion === 'all' || (completion === 'ready' ? annotationReady(c) : !annotationReady(c))) && inDate && (!query || [c.snapshot.input, c.snapshot.output, c.reason, c.expectedAnswer, c.sourceRunId, c.sourceTraceId, ...c.tags].join(' ').toLowerCase().includes(query.toLowerCase()));
  });
  const scoped = store.cases.filter(c => !datasetId || c.datasetIds.includes(datasetId));
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === 'all') next.delete(key); else next.set(key, value); setSelected([]); setParams(next, { replace: true }); };
  const chooseDataset = (id?: string) => { setSelected([]); navigate(`${id ? `/evaluations/datasets/${id}` : '/evaluations'}?${params}`); };
  const openCase = (id: string) => navigate(`/evaluations/cases/${id}?${params}${datasetId ? `&fromDataset=${encodeURIComponent(datasetId)}` : ''}`);
  const columns: TableColumnsType<EvaluationCase> = [
    { title: 'Case / 用户输入', width: 340, render: (_, c) => <button type="button" className="eval-case-link" onClick={() => openCase(c.id)}><strong>{c.snapshot.input}</strong><small>{c.sourceRunId} · {c.snapshot.name}</small><span>{c.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</span></button> },
    { title: '分类', width: 120, render: (_, c) => <CaseTag label={c.label} /> },
    { title: '标注原因', dataIndex: 'reason', width: 230, render: (reason: string) => <span className="eval-table-note">{reason || '待补充'}</span> },
    { title: '完善状态', width: 115, render: (_, c) => <span className={annotationReady(c) ? 'eval-ready' : 'eval-pending'}>{annotationReady(c) ? '● 已完善' : '○ 待完善'}</span> },
    { title: '回流时间', width: 130, dataIndex: 'createdAt', sorter: (a,b) => +new Date(a.createdAt) - +new Date(b.createdAt), render: formatTime },
    { title: '操作', width: 100, render: (_, c) => <Button type="link" size="small" onClick={() => openCase(c.id)}>查看 / 标注</Button> },
  ];
  if (store.loading) return <Spin tip="正在加载共享评测集" fullscreen />;
  if (store.error) return <div className="app-page"><Alert type="error" title="评测集加载失败" description={store.error} action={<Button onClick={reload}>重试</Button>} /></div>;
  if (caseId) {
    const item = store.cases.find(c => c.id === caseId);
    const backTo = params.get('fromDataset');
    const next = new URLSearchParams(params); next.delete('fromDataset');
    return <div className="app-page eval-page">{item ? <CaseReview key={item.id} item={item} onBack={() => navigate(`${backTo ? `/evaluations/datasets/${backTo}` : '/evaluations'}?${next}`)} /> : <Empty description="找不到该 Case，请确认来源或刷新数据"><Button onClick={() => navigate('/evaluations')}>返回评测集</Button></Empty>}</div>;
  }
  if (datasetId && !currentDataset) return <div className="app-page"><Empty description="未找到评测集"><Button onClick={() => navigate('/evaluations')}>返回全部评测集</Button></Empty></div>;
  return <div className="app-page eval-page">
    <PageHeader eyebrow="EVALUATION DATASETS / 知汇台" title="评测集" description="把每天值得保留的问题和需要改进的回答，沉淀为可追溯的 Case。" actions={<Space>{apiEnabled ? <Button onClick={reload}>刷新数据</Button> : null}<Button onClick={() => setGuide(true)}>回流说明</Button><Button icon={<DownloadOutlined />} onClick={() => { exportCases(filtered, store.datasets.filter(d => d.id === datasetId || filtered.some(c => c.datasetIds.includes(d.id)))); void message.success('已导出当前筛选下的 Case、标注及完整快照'); }}>导出 JSON</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { setName(''); setDescription(''); setCreating(true); }}>新建评测集</Button></Space>} />
    <div className="eval-storage-note"><span><i />手动 Case 回流 <Tag color={apiEnabled ? "green" : "purple"}>{apiEnabled ? "真实数据" : "前端原型"}</Tag></span><span>{apiEnabled ? '服务端持久保存 · 跨浏览器共享 · 原始快照不可修改' : '保存于当前浏览器 · 刷新后保留 · 支持导出备份'}</span></div>
    <div className="eval-metrics">{[{ label: '收集 Case', value: scoped.length, hint: '同一请求只创建一份快照', tone: 'purple' }, { label: 'Goodcase', value: scoped.filter(c => c.label === 'goodcase').length, hint: '人工标记 · 值得保留', tone: 'green' }, { label: 'Badcase', value: scoped.filter(c => c.label === 'badcase').length, hint: '人工标记 · 需要改进', tone: 'orange' }, { label: '待完善', value: scoped.filter(c => !annotationReady(c)).length, hint: '补充分类、原因与期望答案', tone: 'blue' }].map(m => <div key={m.label} className={`eval-metric eval-metric--${m.tone}`}><span>{m.label}</span><strong>{m.value}</strong><small>{m.hint}</small></div>)}</div>
    <div className="eval-workspace"><aside className="eval-datasets"><header><strong>评测集</strong><Tag>{store.datasets.length}</Tag></header><button type="button" className={!datasetId ? 'is-active' : ''} onClick={() => chooseDataset()}><ExperimentOutlined /><span><strong>全部 Case</strong><small>跨评测集去重汇总</small></span><b>{store.cases.length}</b></button>{store.datasets.map(d => <button type="button" key={d.id} className={datasetId === d.id ? 'is-active' : ''} onClick={() => chooseDataset(d.id)}><FolderOutlined /><span><strong>{d.name}</strong><small>{d.description || '手动收集与整理'}</small></span><b>{store.cases.filter(c => c.datasetIds.includes(d.id)).length}</b></button>)}<div className="eval-sidebar-tip"><CheckCircleOutlined /><p>先收集，再标注。Goodcase 和 Badcase 可以放在同一个评测集中。</p></div></aside>
    <section className="eval-panel eval-case-list"><header><div><h3>{currentDataset?.name ?? '全部 Case'}</h3><p>{currentDataset?.description ?? '从线上日志中回流，保留原始输入、输出、上下文与完整运行快照。'}</p></div><Tag>{scoped.length} 个样本</Tag></header><div className="eval-filters"><Input prefix={<SearchOutlined />} aria-label="搜索评测 Case" value={query} onChange={e => setFilter('q', e.target.value)} placeholder="搜索问题、原因、标签或 Trace ID" allowClear /><Select aria-label="筛选 Case 分类" value={label} onChange={v => setFilter('label', v)} options={[{ value: 'all', label: '全部分类' }, ...Object.entries(labels).map(([value, v]) => ({ value, label: v.name }))]} /><Select aria-label="Case 完善状态" value={completion} onChange={v => setFilter('completion', v)} options={[{ value: 'all', label: '全部完善状态' }, { value: 'ready', label: '已完善' }, { value: 'pending', label: '待完善' }]} /><Select aria-label="Case 回流时间" value={time} onChange={v => setFilter('time', v)} options={[{ value: 'all', label: '全部回流时间' }, { value: 'today', label: '今天回流' }, { value: 'week', label: '最近 7 天回流' }]} /><Button type="text" onClick={() => { setParams({}); setSelected([]); }}>重置</Button></div>
      {selected.length ? <div className="eval-bulk"><span>已选 {selected.length} 个 Case</span><Select aria-label="批量归集目标" value={bulkTarget} onChange={setBulkTarget} placeholder="选择目标评测集" style={{ width: 210 }} options={store.datasets.map(d => ({ value: d.id, label: d.name }))} /><Button size="small" disabled={!bulkTarget} loading={busy} onClick={() => void collect()}>批量加入</Button><Button type="text" size="small" onClick={() => setSelected([])}>取消选择</Button></div> : null}
      <Table<EvaluationCase> rowKey="id" columns={columns} dataSource={filtered} rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)) }} pagination={{ pageSize: 8, showSizeChanger: false, showTotal: total => `共 ${total} 个样本` }} scroll={{ x: 1080 }} locale={{ emptyText: <Empty description="还没有符合条件的 Case"><Button onClick={() => navigate('/observability/conversations')}>去对话日志回流 Case <ArrowRightOutlined /></Button></Empty> }} />
      <footer className="eval-list-footer"><span>Goodcase / Badcase 为人工判断，与运行成功率独立。</span><Button type="link" size="small" onClick={() => navigate('/observability/conversations')}>查看日志并回流 <ArrowRightOutlined /></Button></footer>
    </section></div>
    <Modal title="新建评测集" open={creating} okText="创建评测集" cancelText="取消" onCancel={() => setCreating(false)} confirmLoading={busy} onOk={() => void addDataset()}><Form layout="vertical"><Form.Item label="评测集名称" required><Input aria-label="评测集名称" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="如：客服问答 · 每日 Case" /></Form.Item><Form.Item label="说明"><Input.TextArea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={500} placeholder="说明收集范围、问题类型或后续用途" /></Form.Item></Form></Modal>
    <Drawer title="手动 Case 回流" width={460} open={guide} onClose={() => setGuide(false)}><div className="eval-guide"><span>01 / 发现</span><h3>每天查看用户日志</h3><p>在对话日志列表或 Agent 执行实录点击“回流 Case”。执行失败不一定是 Badcase，执行成功也不等于回答正确。</p><span>02 / 汇总</span><h3>选择分类与评测集</h3><p>把 goodcase、badcase 或待标注样本归入一个或多个评测集。相同 Trace 和请求再次回流时不重复创建快照。</p><span>03 / 完善</span><h3>补充原因与参考标准</h3><p>标注原因、期望答案、验收要点及标签；原始日志与运行快照不会被修改。完整标注是后续评测准备，不是自动评测结果。</p><Alert type="info" showIcon title={apiEnabled ? 'Case 在服务端共享保存。本期支持人工收集与标注，自动评测执行与打分另行建设。' : '当前为前端原型，演示 Case 保存在此浏览器。'} /></div></Drawer>
  </div>;
}
