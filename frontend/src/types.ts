import type { ReactNode } from 'react';

export type Role = 'admin' | 'manager' | 'user';

export type KnowledgeStatus = 'ready' | 'processing' | 'warning' | 'disabled';

export interface RoleOption {
  id: Role;
  name: string;
  description: string;
  responsibilities: string[];
  color: string;
  icon: ReactNode;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  status: KnowledgeStatus;
  documentCount: number;
  chunkCount: number;
  embeddingModel: string;
  updatedAt: string;
  owner: string;
  tags: string[];
}

/** 文档索引元数据。导入时抽取，供检索与问答引用。 */
export interface DocumentMetadata {
  /** 文档时间，YYYY-MM-DD */
  time: string;
  /** 版本标识 */
  version: string;
  /** 主体信息：产品、组织或文档主题 */
  subject: string;
  /** 负责人 */
  owner: string;
  /** 便于检索的关键词 */
  keywords: string[];
  /** 可能被问到的问题 */
  questions: string[];
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  format: string;
  size: string;
  status: 'ready' | 'processing' | 'failed';
  chunks: number;
  parser: string;
  updatedAt: string;
  errorReason?: string;
  metadata: DocumentMetadata;
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  source: string;
  locator: string;
  enabled: boolean;
  tokens: number;
}

export interface RetrievalResult {
  id: string;
  title: string;
  content: string;
  source: string;
  locator: string;
  denseScore: number;
  keywordScore: number;
  rerankScore: number;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  knowledgeBaseIds: string[];
}

export interface Citation {
  id: string;
  index: number;
  source: string;
  locator: string;
  score: number;
  excerpt: string;
  fileType: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  citations?: Citation[];
  latencyMs?: number;
  tokenCount?: number;
  tokenSource?: 'provider' | 'none' | 'unknown';
  failed?: boolean;
  noEvidence?: boolean;
}

export interface QueryLog {
  id: string;
  traceId: string;
  query: string;
  knowledgeBase: string;
  model: string;
  provider: string;
  status: 'success' | 'error' | 'empty';
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  retrievalMs: number;
  rerankMs: number;
  firstTokenMs: number;
  createdAt: string;
  scenarioId?: string;
}

export interface ProviderProfile {
  id: string;
  provider: 'OpenRouter' | 'AIHubMix' | '通义百炼' | '阿里云 OCR';
  capability: 'LLM' | 'Embedding' | 'Rerank' | 'OCR';
  name: string;
  model: string;
  endpoint: string;
  status: 'healthy' | 'untested' | 'error';
  latencyMs?: number;
  dimension?: number;
  lastChecked?: string;
  errorMessage?: string;
}

export interface ImportTask {
  id: string;
  knowledgeBaseId: string;
  knowledgeBase: string;
  fileName: string;
  stage: string;
  status: 'success' | 'processing' | 'failed';
  progress: number;
  error?: string;
  updatedAt: string;
}

export interface ModelCall {
  id: string;
  traceId: string;
  capability: ProviderProfile['capability'];
  provider: string;
  model: string;
  status: 'success' | 'error';
  tokens: number;
  durationMs: number;
  createdAt: string;
  detail: string;
}
