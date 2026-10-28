import { useCallback, useEffect, useState } from 'react';
import { apiEnabled, request } from '../api/client';
import { obsRuns, type ObsRun } from './data';

export function useObservedRuns(runId?: string) {
  const [runs, setRuns] = useState<ObsRun[]>(apiEnabled ? [] : obsRuns);
  const [loading, setLoading] = useState(apiEnabled);
  const [error, setError] = useState('');
  const [refreshId, setRefreshId] = useState(0);
  const refresh = useCallback(() => setRefreshId(v => v + 1), []);
  useEffect(() => {
    if (!apiEnabled) return;
    let disposed = false;
    setLoading(true);
    async function load() {
      const all: ObsRun[] = [];
      let offset: number | null = 0;
      do {
        const result: { items: ObsRun[]; nextOffset: number | null } = await request(`/observability/runs?offset=${offset}&limit=200`);
        all.push(...result.items);
        offset = result.nextOffset;
        if (disposed) return;
      } while (offset !== null);
      if (runId && !all.some(r => r.id === runId)) all.push(await request<ObsRun>(`/observability/runs/${encodeURIComponent(runId)}`));
      if (!disposed) { setRuns(all); setError(''); }
    }
    void load().catch((e: unknown) => { if (!disposed) setError(e instanceof Error ? e.message : '运行日志加载失败'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [runId, refreshId]);
  return { runs, loading, error, refresh };
}
