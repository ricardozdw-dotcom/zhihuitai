import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { apiEnabled, loadWorkspace } from '../api/client';
import {
  chunksByKnowledgeBase as initialChunks,
  documentsByKnowledgeBase as initialDocuments,
  importTasks as initialImportTasks,
  knowledgeBases as initialKnowledgeBases,
  providerProfiles as initialProfiles,
  queryLogs as initialQueryLogs,
  sampleChunks,
} from '../data/mock';
import type {
  ImportTask,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocument,
  ProviderProfile,
  QueryLog,
  Role,
} from '../types';

interface PrototypeContextValue {
  role: Role | null;
  setRole: (role: Role | null) => void;
  knowledgeBases: KnowledgeBase[];
  addKnowledgeBase: (knowledgeBase: KnowledgeBase) => void;
  updateKnowledgeBase: (id: string, patch: Partial<KnowledgeBase>) => void;
  documentsByKnowledgeBase: Record<string, KnowledgeDocument[]>;
  chunksByKnowledgeBase: Record<string, KnowledgeChunk[]>;
  updateDocument: (
    knowledgeBaseId: string,
    documentId: string,
    patch: Partial<KnowledgeDocument>,
  ) => void;
  removeDocument: (knowledgeBaseId: string, documentId: string) => void;
  retryDocument: (knowledgeBaseId: string, documentId: string) => boolean;
  updateChunk: (
    knowledgeBaseId: string,
    chunkId: string,
    patch: Partial<KnowledgeChunk>,
  ) => void;
  setChunkEnabled: (knowledgeBaseId: string, chunkId: string, enabled: boolean) => void;
  setAllChunksEnabled: (knowledgeBaseId: string, enabled: boolean) => void;
  recordImport: (
    knowledgeBaseId: string,
    documents: KnowledgeDocument[],
    tasks: ImportTask[],
  ) => void;
  selectedKnowledgeBaseIds: string[];
  setSelectedKnowledgeBaseIds: (ids: string[]) => void;
  providerProfiles: ProviderProfile[];
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>;
  queryLogs: QueryLog[];
  addQueryLog: (log: QueryLog) => void;
  importTasks: ImportTask[];
  retryImportTask: (taskId: string) => boolean;
  ocrQuotaPages: number;
  setOcrQuotaPages: (pages: number) => void;
  apiEnabled: boolean;
  apiLoading: boolean;
  apiError: string | null;
  reloadWorkspace: () => Promise<void>;
}

const PrototypeContext = createContext<PrototypeContextValue | undefined>(undefined);

const ROLE_STORAGE_KEY = 'knowledge-hub:prototype:role:v1';

function readInitialRole(): Role | null {
  const value = window.localStorage.getItem(ROLE_STORAGE_KEY);
  return value === 'admin' || value === 'manager' || value === 'user' ? value : null;
}

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [role, updateRole] = useState<Role | null>(readInitialRole);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(() =>
    apiEnabled ? [] : initialKnowledgeBases,
  );
  const [documentsByKnowledgeBase, setDocumentsByKnowledgeBase] = useState(() =>
    apiEnabled ? {} : initialDocuments,
  );
  const [chunksByKnowledgeBase, setChunksByKnowledgeBase] = useState(() =>
    apiEnabled ? {} : initialChunks,
  );
  const [apiLoading, setApiLoading] = useState(apiEnabled);
  const [apiError, setApiError] = useState<string | null>(null);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(
    () => initialProfiles,
  );
  const [queryLogs, setQueryLogs] = useState<QueryLog[]>(() => initialQueryLogs);
  const [importTasks, setImportTasks] = useState<ImportTask[]>(() => initialImportTasks);
  const [ocrQuotaPages, setOcrQuotaPages] = useState(12);
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<string[]>(() =>
    apiEnabled ? [] : ['kb-product'],
  );

  const reloadWorkspace = useCallback(async () => {
    setApiLoading(true);
    setApiError(null);
    try {
      const workspace = await loadWorkspace();
      setKnowledgeBases(workspace.knowledgeBases);
      setDocumentsByKnowledgeBase(workspace.documentsByKnowledgeBase);
      setChunksByKnowledgeBase(workspace.chunksByKnowledgeBase);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : '无法连接后端');
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!apiEnabled) return;
    void reloadWorkspace();
  }, [reloadWorkspace]);

  const setRole = useCallback((nextRole: Role | null) => {
    updateRole(nextRole);
    if (nextRole) {
      window.localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    } else {
      window.localStorage.removeItem(ROLE_STORAGE_KEY);
    }
  }, []);

  const addKnowledgeBase = useCallback((knowledgeBase: KnowledgeBase) => {
    setKnowledgeBases((current) => [knowledgeBase, ...current]);
    setDocumentsByKnowledgeBase((current) => ({ ...current, [knowledgeBase.id]: [] }));
    setChunksByKnowledgeBase((current) => ({ ...current, [knowledgeBase.id]: [] }));
  }, []);

  const updateKnowledgeBase = useCallback((id: string, patch: Partial<KnowledgeBase>) => {
    setKnowledgeBases((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const updateDocument = useCallback(
    (knowledgeBaseId: string, documentId: string, patch: Partial<KnowledgeDocument>) => {
      setDocumentsByKnowledgeBase((current) => ({
        ...current,
        [knowledgeBaseId]: (current[knowledgeBaseId] ?? []).map((document) =>
          document.id === documentId ? { ...document, ...patch } : document,
        ),
      }));
    },
    [],
  );

  const removeDocument = useCallback((knowledgeBaseId: string, documentId: string) => {
    setDocumentsByKnowledgeBase((current) => ({
      ...current,
      [knowledgeBaseId]: (current[knowledgeBaseId] ?? []).filter(
        (document) => document.id !== documentId,
      ),
    }));
    setKnowledgeBases((current) =>
      current.map((item) =>
        item.id === knowledgeBaseId
          ? {
              ...item,
              documentCount: Math.max(0, item.documentCount - 1),
              updatedAt: '刚刚',
            }
          : item,
      ),
    );
  }, []);

  const retryDocument = useCallback(
    (knowledgeBaseId: string, documentId: string) => {
      const document = (documentsByKnowledgeBase[knowledgeBaseId] ?? []).find(
        (item) => item.id === documentId,
      );
      if (!document) return false;
      if (document.errorReason?.includes('额度') && ocrQuotaPages < 40) {
        return false;
      }
      const addedChunks = document.status === 'failed' ? document.chunks || 24 : 0;
      updateDocument(knowledgeBaseId, documentId, {
        status: 'processing',
        errorReason: undefined,
        updatedAt: '刚刚',
      });
      window.setTimeout(() => {
        setDocumentsByKnowledgeBase((current) => ({
          ...current,
          [knowledgeBaseId]: (current[knowledgeBaseId] ?? []).map((item) =>
            item.id === documentId
              ? {
                  ...item,
                  status: 'ready',
                  chunks: item.chunks || addedChunks,
                  updatedAt: '刚刚',
                  errorReason: undefined,
                }
              : item,
          ),
        }));
        if (addedChunks > 0) {
          setKnowledgeBases((current) =>
            current.map((item) =>
              item.id === knowledgeBaseId
                ? { ...item, chunkCount: item.chunkCount + addedChunks, updatedAt: '刚刚' }
                : item,
            ),
          );
        }
      }, 900);
      return true;
    },
    [documentsByKnowledgeBase, ocrQuotaPages, updateDocument],
  );

  const updateChunk = useCallback(
    (knowledgeBaseId: string, chunkId: string, patch: Partial<KnowledgeChunk>) => {
      setChunksByKnowledgeBase((current) => ({
        ...current,
        [knowledgeBaseId]: (current[knowledgeBaseId] ?? []).map((chunk) =>
          chunk.id === chunkId ? { ...chunk, ...patch } : chunk,
        ),
      }));
    },
    [],
  );

  const setChunkEnabled = useCallback(
    (knowledgeBaseId: string, chunkId: string, enabled: boolean) => {
      updateChunk(knowledgeBaseId, chunkId, { enabled });
    },
    [updateChunk],
  );

  const setAllChunksEnabled = useCallback((knowledgeBaseId: string, enabled: boolean) => {
    setChunksByKnowledgeBase((current) => ({
      ...current,
      [knowledgeBaseId]: (current[knowledgeBaseId] ?? []).map((chunk) => ({ ...chunk, enabled })),
    }));
  }, []);

  const recordImport = useCallback(
    (knowledgeBaseId: string, documents: KnowledgeDocument[], tasks: ImportTask[]) => {
      setDocumentsByKnowledgeBase((current) => ({
        ...current,
        [knowledgeBaseId]: [...documents, ...(current[knowledgeBaseId] ?? [])],
      }));
      setChunksByKnowledgeBase((current) => {
        const existing = current[knowledgeBaseId] ?? [];
        if (existing.length > 0) return current;
        return {
          ...current,
          [knowledgeBaseId]: sampleChunks.map((chunk) => ({
            ...chunk,
            id: `${knowledgeBaseId}-${chunk.id}`,
          })),
        };
      });
      setKnowledgeBases((current) =>
        current.map((item) => {
          if (item.id !== knowledgeBaseId) return item;
          const importedChunks = documents.reduce((sum, document) => sum + document.chunks, 0);
          return {
            ...item,
            status: item.status === 'disabled' ? item.status : 'ready',
            documentCount: item.documentCount + documents.length,
            chunkCount: item.chunkCount + importedChunks,
            updatedAt: '刚刚',
            tags: item.tags.filter((tag) => tag !== '未导入'),
          };
        }),
      );
      setImportTasks((current) => [...tasks, ...current]);
    },
    [],
  );

  const addQueryLog = useCallback((log: QueryLog) => {
    setQueryLogs((current) => [log, ...current]);
  }, []);

  const retryImportTask = useCallback(
    (taskId: string) => {
      const task = importTasks.find((item) => item.id === taskId);
      if (!task) return false;
      if (task.error?.includes('额度') && ocrQuotaPages < 40) return false;
      setImportTasks((current) =>
        current.map((item) =>
          item.id === taskId
            ? { ...item, status: 'processing', progress: 36, error: undefined, updatedAt: '刚刚' }
            : item,
        ),
      );
      window.setTimeout(() => {
        setImportTasks((current) =>
          current.map((item) =>
            item.id === taskId
              ? { ...item, status: 'success', progress: 100, stage: '完成', updatedAt: '刚刚' }
              : item,
          ),
        );
      }, 900);
      return true;
    },
    [importTasks, ocrQuotaPages],
  );

  const value = useMemo<PrototypeContextValue>(
    () => ({
      role,
      setRole,
      knowledgeBases,
      addKnowledgeBase,
      updateKnowledgeBase,
      documentsByKnowledgeBase,
      chunksByKnowledgeBase,
      updateDocument,
      removeDocument,
      retryDocument,
      updateChunk,
      setChunkEnabled,
      setAllChunksEnabled,
      recordImport,
      selectedKnowledgeBaseIds,
      setSelectedKnowledgeBaseIds,
      providerProfiles,
      setProviderProfiles,
      queryLogs,
      addQueryLog,
      importTasks,
      retryImportTask,
      ocrQuotaPages,
      setOcrQuotaPages,
      apiEnabled,
      apiLoading,
      apiError,
      reloadWorkspace,
    }),
    [
      addKnowledgeBase,
      addQueryLog,
      chunksByKnowledgeBase,
      documentsByKnowledgeBase,
      importTasks,
      knowledgeBases,
      apiError,
      apiLoading,
      ocrQuotaPages,
      providerProfiles,
      reloadWorkspace,
      queryLogs,
      recordImport,
      removeDocument,
      retryDocument,
      retryImportTask,
      role,
      selectedKnowledgeBaseIds,
      setAllChunksEnabled,
      setChunkEnabled,
      setRole,
      updateChunk,
      updateDocument,
      updateKnowledgeBase,
    ],
  );

  return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
}

export function usePrototype() {
  const context = useContext(PrototypeContext);
  if (!context) {
    throw new Error('usePrototype must be used inside PrototypeProvider');
  }
  return context;
}
