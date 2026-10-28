import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Alert, Button, Form, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import { FolderAddOutlined, PlusOutlined } from '@ant-design/icons';
import type { ObsRun } from '../observability/data';
import { captureCase, createDataset, useEvaluationStore, type CaseLabel } from './store';
import './evaluations.css';
import { apiEnabled } from '../api/client';

interface CaptureDraft { datasetIds: string[]; label: CaseLabel; reason: string; expectedAnswer: string; tags: string[] }

export function CaptureCaseButton({ run, compact = false }: { run: ObsRun; compact?: boolean }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const store = useEvaluationStore();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CaptureDraft>();
  const existing = store.cases.find(c => c.sourceRunId === run.id && c.sourceTraceId === run.traceId);
  const show = () => {
    form.setFieldsValue({ datasetIds: existing?.datasetIds ?? (store.datasets[0] ? [store.datasets[0].id] : []), label: existing?.label ?? 'unlabeled', reason: existing?.reason ?? '', expectedAnswer: existing?.expectedAnswer ?? '', tags: existing?.tags ?? [] });
    setOpen(true);
  };
  const save = async () => {
    try {
      const draft = await form.validateFields();
      setSaving(true);
      const result = await captureCase(run, { ...draft, reason: draft.reason ?? '', expectedAnswer: draft.expectedAnswer ?? '', tags: draft.tags ?? [] });
      setOpen(false);
      void message.success({ content: <span>{result.duplicate ? result.addedMembership ? '已加入目标评测集，保留原标注与快照。' : '该请求已回流，未重复创建。' : 'Case 已回流并保存运行快照。'} <Button type="link" size="small" onClick={() => navigate(`/evaluations/cases/${result.item.id}`)}>查看 Case</Button></span>, duration: 6 });
    } catch (error) {
      if (error instanceof Error) void message.error(error.message.includes('quota') || error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请先导出备份后再保存。' : error.message);
    } finally { setSaving(false); }
  };
  const addDataset = async () => {
    setCreating(true);
    try {
      const dataset = await createDataset(newName);
      form.setFieldValue('datasetIds', [...(form.getFieldValue('datasetIds') ?? []), dataset.id]);
      setNewName(''); void message.success('评测集已创建');
    } catch (error) { void message.error(error instanceof Error ? error.message : '创建失败'); }
    finally { setCreating(false); }
  };
  return <>
    <Button size={compact ? 'small' : 'middle'} type={compact ? 'link' : 'default'} icon={compact ? undefined : <FolderAddOutlined />} onClick={show} disabled={store.loading || Boolean(store.error) || ['running', 'waiting', 'unknown'].includes(run.status)}>{existing ? '已回流' : '回流 Case'}</Button>
    <Modal title="回流线上 Case" open={open} width={690} okText={existing ? '加入评测集' : '保存 Case'} cancelText="取消" confirmLoading={saving} onCancel={() => setOpen(false)} onOk={() => void save()} destroyOnHidden>
      <Alert type="info" showIcon title={existing ? '该运行已回流。再次保存只补充评测集归属；修改分类和内容请进入 Case 详情。' : '保存当前请求的输入、输出、上下文与调用链快照，后续标注不改变原始日志。'} />
      <div className="case-capture-source"><Tag color="purple">{apiEnabled ? '服务端运行记录' : '演示日志'}</Tag><strong>{run.name}</strong><small>{run.id} · {run.traceId}</small><p>{run.input}</p></div>
      <Form form={form} layout="vertical" disabled={saving}>
        <Form.Item name="datasetIds" label="归入评测集" rules={[{ required: true, message: '请选择至少一个评测集' }]}><Select mode="multiple" aria-label="回流目标评测集" options={store.datasets.map(d => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Space.Compact style={{ width: '100%', marginBottom: 20 }}><Input aria-label="新评测集名称" placeholder="也可在这里新建评测集" value={newName} onChange={e => setNewName(e.target.value)} maxLength={60} /><Button icon={<PlusOutlined />} loading={creating} onClick={() => void addDataset()}>新建</Button></Space.Compact>
        <Form.Item name="label" label="人工分类"><Radio.Group disabled={Boolean(existing)} options={[{ value: 'goodcase', label: 'Goodcase · 值得保留' }, { value: 'badcase', label: 'Badcase · 需要改进' }, { value: 'unlabeled', label: '待标注' }]} /></Form.Item>
        <Form.Item name="reason" label="标注原因 / 问题描述"><Input.TextArea rows={2} disabled={Boolean(existing)} placeholder="例如：引用准确；或检索遗漏、工具调用失败、答案不完整" maxLength={4000} showCount /></Form.Item>
        <Form.Item name="expectedAnswer" label="期望答案 / 验收要点（可稍后补充）"><Input.TextArea rows={3} disabled={Boolean(existing)} placeholder="写下正确答案或应该满足的行为，不自动把模型原回答当作标准答案" maxLength={12000} showCount /></Form.Item>
        <Form.Item name="tags" label="标签"><Select mode="tags" disabled={Boolean(existing)} placeholder="输入后回车，如：引用准确、召回遗漏、上下文超限" tokenSeparators={[',', '，']} options={['引用准确', '召回遗漏', '答案不完整', '工具失败', '上下文超限', '典型问题'].map(value => ({ value, label: value }))} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
