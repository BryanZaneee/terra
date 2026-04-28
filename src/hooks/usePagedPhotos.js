import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { processPhotos } from '../utils/photoHelpers';
import { CONFIG } from '../config';

/**
 * Cursor-paginated photo loader (PAGINATION_PLAN.md).
 *
 * Composed by `usePhotos` so the existing `[photos, setPhotos]` state stays
 * single-sourced. This hook only owns the cursor + paging-loading flag and
 * writes results back through the supplied setters.
 *
 * `loadFirstPage(filter)` resets the page walk for a new filter; the active
 * filter is captured in a ref so `loadNextPage` keeps using it even after
 * later renders without forcing the caller to re-pass it on every scroll.
 */
export function usePagedPhotos({ setPhotos, setLoading, setError }) {
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const filterRef = useRef({ kind: 'all' });
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const loadFirstPage = useCallback(async (filter = { kind: 'all' }) => {
    filterRef.current = filter;
    setLoading(true);
    if (setError) setError(null);
    try {
      const result = await invoke('get_photos_page', {
        filter,
        cursor: null,
        limit: CONFIG.PAGE_SIZE,
      });
      if (!isMountedRef.current) return;
      setPhotos(processPhotos(result.photos));
      setNextCursor(result.next_cursor ?? null);
    } catch (err) {
      console.error('Failed to load first page:', err);
      if (setError) setError(typeof err === 'string' ? err : err?.message ?? 'Failed to load photos');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [setPhotos, setLoading, setError]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor || loadingPage) return;
    setLoadingPage(true);
    try {
      const result = await invoke('get_photos_page', {
        filter: filterRef.current,
        cursor: nextCursor,
        limit: CONFIG.PAGE_SIZE,
      });
      if (!isMountedRef.current) return;
      setPhotos((prev) => [...prev, ...processPhotos(result.photos)]);
      setNextCursor(result.next_cursor ?? null);
    } catch (err) {
      console.error('Failed to load next page:', err);
    } finally {
      if (isMountedRef.current) setLoadingPage(false);
    }
  }, [nextCursor, loadingPage, setPhotos]);

  return {
    loadFirstPage,
    loadNextPage,
    hasMore: nextCursor != null,
    loadingPage,
    nextCursor,
  };
}
