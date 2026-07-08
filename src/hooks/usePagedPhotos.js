import { useCallback, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { processPhotos } from '../utils/photoHelpers';
import { CONFIG } from '../config';
import { useAsyncGuard } from './useAsyncGuard';

/**
 * Cursor-paginated photo loader (PAGINATION_PLAN.md).
 */
export function usePagedPhotos({ setPhotos, setLoading, setError }) {
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const filterRef = useRef({ kind: 'all' });
  const activeRef = useAsyncGuard();

  const loadFirstPage = useCallback(async (filter) => {
    if (filter !== undefined) filterRef.current = filter;
    const activeFilter = filterRef.current;
    setLoading(true);
    if (setError) setError(null);
    try {
      const result = await invoke('get_photos_page', {
        filter: activeFilter,
        cursor: null,
        limit: CONFIG.PAGE_SIZE,
      });
      if (!activeRef.current) return;
      setPhotos(processPhotos(result.photos));
      setNextCursor(result.next_cursor ?? null);
    } catch (err) {
      console.error('Failed to load first page:', err);
      if (setError) setError(typeof err === 'string' ? err : err?.message ?? 'Failed to load photos');
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [setPhotos, setLoading, setError, activeRef]);

  const reloadCurrentView = useCallback(async () => {
    await loadFirstPage(undefined);
  }, [loadFirstPage]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor || loadingPage) return;
    setLoadingPage(true);
    try {
      const result = await invoke('get_photos_page', {
        filter: filterRef.current,
        cursor: nextCursor,
        limit: CONFIG.PAGE_SIZE,
      });
      if (!activeRef.current) return;
      setPhotos((prev) => [...prev, ...processPhotos(result.photos)]);
      setNextCursor(result.next_cursor ?? null);
    } catch (err) {
      console.error('Failed to load next page:', err);
    } finally {
      if (activeRef.current) setLoadingPage(false);
    }
  }, [nextCursor, loadingPage, setPhotos, activeRef]);

  return {
    loadFirstPage,
    reloadCurrentView,
    loadNextPage,
    hasMore: nextCursor != null,
    loadingPage,
    nextCursor,
  };
}
