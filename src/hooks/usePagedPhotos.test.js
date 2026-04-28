import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagedPhotos } from './usePagedPhotos';
import { CONFIG } from '../config';

const { invoke } = await import('@tauri-apps/api/core');

function setup() {
  const setPhotos = vi.fn();
  const setLoading = vi.fn();
  const setError = vi.fn();
  const { result } = renderHook(() =>
    usePagedPhotos({ setPhotos, setLoading, setError }),
  );
  return { result, setPhotos, setLoading, setError };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePagedPhotos', () => {
  it('starts with no cursor and no in-flight page', () => {
    const { result } = setup();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingPage).toBe(false);
    expect(result.current.nextCursor).toBe(null);
  });

  it('loadFirstPage seeds photos and captures next_cursor', async () => {
    invoke.mockResolvedValueOnce({
      photos: [
        { path: '/p/1.jpg', name: '1.jpg', date_taken: 1000, is_favorite: false },
        { path: '/p/2.jpg', name: '2.jpg', date_taken: 999, is_favorite: false },
      ],
      next_cursor: { date_taken: 999, id: 7 },
    });

    const { result, setPhotos, setLoading } = setup();

    await act(async () => {
      await result.current.loadFirstPage({ kind: 'all' });
    });

    expect(invoke).toHaveBeenCalledWith('get_photos_page', {
      filter: { kind: 'all' },
      cursor: null,
      limit: CONFIG.PAGE_SIZE,
    });
    expect(setPhotos).toHaveBeenCalledTimes(1);
    // first call replaces the array — argument is the processed list
    const replaced = setPhotos.mock.calls[0][0];
    expect(replaced).toHaveLength(2);
    expect(replaced[0].path).toBe('/p/1.jpg');
    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(result.current.hasMore).toBe(true);
  });

  it('loadNextPage appends and forwards the captured filter + cursor', async () => {
    // Page 1
    invoke.mockResolvedValueOnce({
      photos: [{ path: '/p/1.jpg', name: '1.jpg', date_taken: 1000, is_favorite: false }],
      next_cursor: { date_taken: 1000, id: 5 },
    });
    // Page 2
    invoke.mockResolvedValueOnce({
      photos: [{ path: '/p/2.jpg', name: '2.jpg', date_taken: 999, is_favorite: false }],
      next_cursor: null,
    });

    const { result, setPhotos } = setup();

    await act(async () => {
      await result.current.loadFirstPage({ kind: 'all' });
    });
    await act(async () => {
      await result.current.loadNextPage();
    });

    // Second call must pass the cursor returned from page 1.
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_photos_page', {
      filter: { kind: 'all' },
      cursor: { date_taken: 1000, id: 5 },
      limit: CONFIG.PAGE_SIZE,
    });
    // setPhotos was called twice: replace, then functional append.
    expect(setPhotos).toHaveBeenCalledTimes(2);
    const appender = setPhotos.mock.calls[1][0];
    expect(typeof appender).toBe('function');
    const merged = appender([{ path: '/p/1.jpg' }]);
    expect(merged.map((p) => p.path)).toEqual(['/p/1.jpg', '/p/2.jpg']);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadNextPage is a no-op when no cursor exists', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.loadNextPage();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('loadFirstPage propagates errors via setError and clears loading', async () => {
    invoke.mockRejectedValueOnce('boom');
    const { result, setError, setLoading } = setup();
    await act(async () => {
      await result.current.loadFirstPage({ kind: 'all' });
    });
    expect(setError).toHaveBeenCalledWith('boom');
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});
