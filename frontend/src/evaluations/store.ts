import { useEffect, useSyncExternalStore } from 'react';
import { obsRuns, type ObsRun } from '../observability/data';
import { apiEnabled, request } from '../api/client';

export type CaseLabel = 'goodcase' | 'badcase' | 'unlabeled';
export interface EvaluationDataset {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}
export interface EvaluationCase {
  id: string;
  datasetIds: string[];
  label: CaseLabel;
  reason: string;
  expectedAnswer: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sourceRunId: string;
  sourceTraceId: string;
  sourceUrl: string;
  sourceKind: ObsRun['kind'];
  snapshot: ObsRun;
  revision?: number;
}
export interface EvaluationState {
  version: 1;
  datasets: EvaluationDataset[];
  cases: EvaluationCase[];
  loading?: boolean;
  error?: string;
}

export const EVALUATION_STORAGE_KEY = 'zhihuitai:evaluations:v1';
const LOCAL_EVENT = 'zhihuitai:evaluations:updated';
let cached: EvaluationState | undefined;
let rawCache: string | null | undefined;
let remote: EvaluationState = { version: 1, datasets: [], cases: [], loading: true };
const remoteListeners = new Set<() => void>();
let inFlight: Promise<void> | undefined;
let sequence = 0;
let loaded = false;
function publishRemote(next: EvaluationState) { remote = next; remoteListeners.forEach(fn => fn()); }
function commitRemote(next: EvaluationState) {
  ++sequence; // An older background GET must not overwrite a completed mutation.
  loaded = true;
  publishRemote({ ...next, loading: false });
}
export function refreshEvaluations(force = false): Promise<void> {
  if (!apiEnabled) return Promise.resolve();
  if (inFlight && !force) return inFlight;
  const current = ++sequence;
  const pending = request<EvaluationState>('/evaluations/state').then(state => {
    if (current === sequence) { loaded = true; publishRemote({ ...state, loading: false }); }
  }).catch((error: unknown) => {
    if (current === sequence) publishRemote({ ...remote, loading: false, error: error instanceof Error ? error.message : '加载失败' });
    throw error;
  }).finally(() => { if (inFlight === pending) inFlight = undefined; });
  inFlight = pending;
  return pending;
}
function subscribeRemote(callback: () => void) {
  remoteListeners.add(callback);
  const refresh = () => { void refreshEvaluations().catch(() => {}); };
  window.addEventListener('focus', refresh);
  return () => { remoteListeners.delete(callback); window.removeEventListener('focus', refresh); };
}

export function cloneRun(run: ObsRun): ObsRun {
  return JSON.parse(JSON.stringify(run)) as ObsRun;
}
export function sourceUrl(run: ObsRun) {
  return `/observability/${run.kind === 'chat' ? 'conversations' : run.kind === 'build' ? 'builds' : 'agents'}/${encodeURIComponent(run.id)}`;
}
function seed(): EvaluationState {
  const stamp = new Date().toISOString();
  const examples = [
    { run: obsRuns.find(r => r.id === 'chat-032')!, label: 'goodcase' as const, reason: '回答有明确条款依据，引用位置可追溯。', expected: '提前一个工作日提交日期、地点与工作安排，经直属主管批准后生效；保持通讯在线并按约定反馈交付。', tags: ['制度问答', '引用准确'] },
    { run: obsRuns.find(r => r.id === 'agent-026')!, label: 'badcase' as const, reason: '工具返回过大导致上下文超限，任务未能完成。', expected: '在上下文预算内选择相关制度证据，完成申请流程说明并给出引用。', tags: ['上下文超限', 'Agent'] },
  ];
  return {
    version: 1,
    datasets: [
      { id: 'daily-cases', name: '每日 Case 收集', description: '日常查看日志时手动收集 goodcase / badcase，保留标注与运行快照。', createdAt: stamp },
      { id: 'rag-regression', name: 'RAG 回归基准', description: '已整理的代表性问答与异常样本，用于后续评测准备。', createdAt: stamp },
    ],
    cases: examples.map((item, index) => ({
      id: `case-demo-${index + 1}`, datasetIds: index === 0 ? ['daily-cases', 'rag-regression'] : ['daily-cases'], label: item.label,
      reason: item.reason, expectedAnswer: item.expected, tags: item.tags, createdAt: stamp, updatedAt: stamp,
      sourceRunId: item.run.id, sourceTraceId: item.run.traceId, sourceUrl: sourceUrl(item.run), sourceKind: item.run.kind, snapshot: cloneRun(item.run),
    })),
  };
}

function validState(value: unknown): value is EvaluationState {
  if (!value || typeof value !== 'object') return false;
  const s = value as EvaluationState;
  return s.version === 1 && Array.isArray(s.datasets) && Array.isArray(s.cases)
    && s.datasets.every(d => typeof d.id === 'string' && typeof d.name === 'string' && typeof d.description === 'string')
    && s.cases.every(c => typeof c.id === 'string' && Array.isArray(c.datasetIds) && ['goodcase', 'badcase', 'unlabeled'].includes(c.label) && typeof c.reason === 'string' && typeof c.expectedAnswer === 'string' && Array.isArray(c.tags) && typeof c.sourceRunId === 'string' && typeof c.sourceTraceId === 'string' && typeof c.sourceUrl === 'string' && c.snapshot && typeof c.snapshot.input === 'string' && Array.isArray(c.snapshot.nodes));
}
function read(): EvaluationState {
  let raw: string | null;
  try { raw = window.localStorage.getItem(EVALUATION_STORAGE_KEY); } catch { return cached ??= seed(); }
  if (cached && raw === rawCache) return cached;
  rawCache = raw;
  try { const value: unknown = raw ? JSON.parse(raw) : null; cached = validState(value) ? value : seed(); }
  catch { cached = seed(); }
  return cached;
}
function persist(next: EvaluationState) {
  const raw = JSON.stringify(next);
  // 写入成功后再发布状态；额度不足时保留原数据，由调用方提示。
  window.localStorage.setItem(EVALUATION_STORAGE_KEY, raw);
  cached = next; rawCache = raw;
  window.dispatchEvent(new Event(LOCAL_EVENT));
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === EVALUATION_STORAGE_KEY || event.key === null) callback(); };
  window.addEventListener(LOCAL_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(LOCAL_EVENT, callback); window.removeEventListener('storage', onStorage); };
}
export function useEvaluationStore() {
  const state = useSyncExternalStore(apiEnabled ? subscribeRemote : subscribe, apiEnabled ? () => remote : read);
  useEffect(() => { if (apiEnabled && !loaded) void refreshEvaluations().catch(() => {}); }, []);
  return state;
}
export async function createDataset(name: string, description = '') {
  if (apiEnabled) {
    const dataset = await request<EvaluationDataset>('/evaluations/datasets', { method: 'POST', body: JSON.stringify({ name, description }) });
    commitRemote({ ...remote, datasets: [dataset, ...remote.datasets], error: undefined });
    return dataset;
  }
  const state = read();
  const normalized = name.trim();
  if (!normalized) throw new Error('请填写评测集名称');
  if (state.datasets.some(d => d.name === normalized)) throw new Error('已存在同名评测集');
  const dataset: EvaluationDataset = { id: `dataset-${crypto.randomUUID()}`, name: normalized, description: description.trim(), createdAt: new Date().toISOString() };
  persist({ ...state, datasets: [dataset, ...state.datasets] });
  return dataset;
}
export async function captureCase(run: ObsRun, draft: Pick<EvaluationCase, 'datasetIds' | 'label' | 'reason' | 'expectedAnswer' | 'tags'>) {
  if (apiEnabled) {
    const result = await request<{ item: EvaluationCase; duplicate: boolean; addedMembership: boolean }>('/evaluations/cases', { method: 'POST', body: JSON.stringify({ ...draft, sourceRunId: run.id, sourceTraceId: run.traceId }) });
    commitRemote({ ...remote, cases: [result.item, ...remote.cases.filter(c => c.id !== result.item.id)], error: undefined });
    return result;
  }
  const state = read();
  if (!draft.datasetIds.length || draft.datasetIds.some(id => !state.datasets.some(d => d.id === id))) throw new Error('请选择有效的评测集');
  const previous = state.cases.find(c => c.sourceRunId === run.id && c.sourceTraceId === run.traceId);
  if (previous) {
    const datasetIds = [...new Set([...previous.datasetIds, ...draft.datasetIds])];
    const addedMembership = datasetIds.length > previous.datasetIds.length;
    if (addedMembership) persist({ ...state, cases: state.cases.map(c => c.id === previous.id ? { ...c, datasetIds, updatedAt: new Date().toISOString() } : c) });
    return { item: previous, duplicate: true, addedMembership };
  }
  const stamp = new Date().toISOString();
  const item: EvaluationCase = { ...draft, reason: draft.reason.trim(), expectedAnswer: draft.expectedAnswer.trim(), id: `case-${crypto.randomUUID()}`, createdAt: stamp, updatedAt: stamp, sourceRunId: run.id, sourceTraceId: run.traceId, sourceUrl: sourceUrl(run), sourceKind: run.kind, snapshot: cloneRun(run) };
  persist({ ...state, cases: [item, ...state.cases] });
  return { item, duplicate: false, addedMembership: true };
}
export async function updateCase(id: string, patch: Partial<Pick<EvaluationCase, 'label' | 'reason' | 'expectedAnswer' | 'tags' | 'datasetIds'>>, expectedRevision?: number) {
  if (apiEnabled) {
    const item = remote.cases.find(c => c.id === id);
    if (!item) throw new Error('找不到该 Case');
    const next = await request<EvaluationCase>(`/evaluations/cases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label: item.label, reason: item.reason, expectedAnswer: item.expectedAnswer, tags: item.tags, datasetIds: item.datasetIds, ...patch, expectedRevision }) });
    commitRemote({ ...remote, cases: remote.cases.map(c => c.id === id ? next : c), error: undefined });
    return next;
  }
  const state = read();
  if (!state.cases.some(c => c.id === id)) throw new Error('找不到该 Case');
  if (patch.datasetIds && (!patch.datasetIds.length || patch.datasetIds.some(d => !state.datasets.some(item => item.id === d)))) throw new Error('Case 至少保留一个有效评测集');
  persist({ ...state, cases: state.cases.map(c => c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c) });
  return read().cases.find(c => c.id === id)!;
}
export async function bulkAddCases(caseIds: string[], datasetId: string) {
  if (apiEnabled) {
    await request('/evaluations/cases/bulk-collect', { method: 'POST', body: JSON.stringify({ caseIds, datasetId }) });
    await refreshEvaluations(true);
    return;
  }
  const state = read();
  if (!state.datasets.some(d => d.id === datasetId)) throw new Error('找不到目标评测集');
  persist({ ...state, cases: state.cases.map(c => caseIds.includes(c.id) ? { ...c, datasetIds: [...new Set([...c.datasetIds, datasetId])], updatedAt: new Date().toISOString() } : c) });
}
export function annotationReady(c: EvaluationCase) { return c.label !== 'unlabeled' && Boolean(c.reason.trim()) && Boolean(c.expectedAnswer.trim()); }
