import { useCallback, useEffect, useRef } from 'react';
import { resolveViewQuery } from '../utils/viewQuery';
import { useAsyncGuard } from './useAsyncGuard';

/** Loads photos for the active view via the paginated path only. */
export function useViewPhotoLoader({
  viewMode,
  selectedTagIds,
  searchQuery,
  loadPhotosFromDatabase,
}) {
  const activeRef = useAsyncGuard();
  const lastQueryKeyRef = useRef('all');

  const runQuery = useCallback(async (query) => {
    if (query.strategy !== 'paginated') return;
    if (query.queryKey === lastQueryKeyRef.current) return;
    lastQueryKeyRef.current = query.queryKey;
    if (!activeRef.current) return;
    await loadPhotosFromDatabase(query.filter);
  }, [loadPhotosFromDatabase, activeRef]);

  useEffect(() => {
    runQuery(resolveViewQuery(viewMode, { selectedTagIds, searchQuery }));
  }, [viewMode, selectedTagIds, searchQuery, runQuery]);

  const loadSearch = useCallback(async (trimmedQuery) => {
    lastQueryKeyRef.current = `search:${trimmedQuery}`;
    await loadPhotosFromDatabase({ kind: 'search', query: trimmedQuery });
  }, [loadPhotosFromDatabase]);

  const invalidateQueryKey = useCallback(() => {
    lastQueryKeyRef.current = null;
  }, []);

  return { loadSearch, invalidateQueryKey };
}
