import type {
  DocumentMetadata,
  ImportTask,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
} from '../types';

export const apiEnabled = import.meta.env.VITE_USE_API === 'true';
export const apiBase = import.meta.env.VITE_API_BASE || '/api';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let detail = text || response.statusText;
    try {
      const payload = JSON.parse(text) as { detail?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
    } catch {
      detail = text || response.statusText;
    }
    throw new Error(detail || '请求失败');
  }
  return (await response.json()) as T;
}

export interface WorkspaceSnapshot {
  knowledgeBases: KnowledgeBase[];
  documentsByKnowledgeBase: Record<string, KnowledgeDocument[]>;
  chunksByKnowledgeBase: Record<string, KnowledgeChunk[]>;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const knowledgeBases = await request<KnowledgeBase[]>('/knowledge-bases');
  const documentsByKnowledgeBase: Record<string, KnowledgeDocument[]> = {};
  const chunksByKnowledgeBase: Record<string, KnowledgeChunk[]> = {};
  await Promise.all(
    knowledgeBases.map(async (item) => {
      const [documents, chunks] = await Promise.all([
        request<KnowledgeDocument[]>(`/knowledge-bases/${item.id}/documents`),
        request<KnowledgeChunk[]>(`/knowledge-bases/${item.id}/chunks`),
      ]);
      documentsByKnowledgeBase[item.id] = documents;
      chunksByKnowledgeBase[item.id] = chunks;
    }),
  );
  return { knowledgeBases, documentsByKnowledgeBase, chunksByKnowledgeBase };
}

export function createRemoteKnowledgeBase(input: {
  name: string;
  description?: string;
  owner: string;
  embeddingModel: string;
}) {
  return request<KnowledgeBase>('/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function uploadDocument(knowledgeBaseId: string, file: File, metadata: DocumentMetadata) {
  const body = new FormData();
  body.append('file', file);
  body.append('metadata', JSON.stringify(metadata));
  return request<{ document: KnowledgeDocument; task: ImportTask }>(
    `/knowledge-bases/${knowledgeBaseId}/documents`,
    { method: 'POST', body },
  );
}


export interface ChatStreamCitation {
  id: string;
  index: number;
  source: string;
  locator: string;
  score: number;
  excerpt: string;
  fileType: string;
}

export interface ChatStreamHandlers {
  onCitation?: (citations: ChatStreamCitation[]) => void;
  onToken?: (text: string) => void;
  onDone?: (meta: {
    traceId?: string;
    conversationId?: string;
    noEvidence?: boolean;
    model?: string;
    provider?: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    tokenSource?: 'provider' | 'none' | 'unknown';
  }) => void;
  signal?: AbortSignal;
}

/** 消费后端 SSE：citation / token / done */
export async function streamChatCompletions(
  input: {
    message: string;
    knowledgeBaseIds: string[];
    conversationId?: string | null;
    scenarioId?: string | null;
  },
  handlers: ChatStreamHandlers = {},
): Promise<void> {
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: handlers.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text || response.statusText;
    try {
      const payload = JSON.parse(text) as { detail?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
    } catch {
      /* keep */
    }
    throw new Error(detail || '问答请求失败');
  }
  if (!response.body) throw new Error('浏览器不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = 'message';
  let receivedDone = false;

  const flushBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let dataLines: string[] = [];
    let localEvent = eventName;
    for (const line of lines) {
      if (line.startsWith('event:')) localEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') return;
    let payload: unknown = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      /* plain text */
    }
    if (localEvent === 'citation' && payload && typeof payload === 'object') {
      const citations = (payload as { citations?: ChatStreamCitation[] }).citations ?? [];
      handlers.onCitation?.(citations);
      return;
    }
    if (localEvent === 'token' && payload && typeof payload === 'object') {
      const text = (payload as { text?: string }).text ?? '';
      if (text) handlers.onToken?.(text);
      return;
    }
    if (localEvent === 'error' && payload && typeof payload === 'object') {
      const message = (payload as { message?: string }).message || '问答失败';
      throw new Error(message);
    }
    if (localEvent === 'done' && payload && typeof payload === 'object') {
      receivedDone = true;
      handlers.onDone?.(payload as {
        traceId?: string;
        conversationId?: string;
        noEvidence?: boolean;
        model?: string;
        provider?: string;
        inputTokens?: number | null;
        outputTokens?: number | null;
        tokenSource?: 'provider' | 'none' | 'unknown';
      });
      return;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) flushBlock(block);
    }
  }
  if (buffer.trim()) flushBlock(buffer);
  if (!receivedDone) throw new Error('对话连接提前结束，未收到服务端完成记录，请在日志中心核对状态。');
}

export function getImportTask(taskId: string) {
  return request<ImportTask>(`/import-tasks/${taskId}`);
}
