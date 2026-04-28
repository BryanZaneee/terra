import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePhotos } from './usePhotos';

const { invoke } = await import('@tauri-apps/api/core');
const { open } = await import('@tauri-apps/plugin-dialog');

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue([]);
  open.mockResolvedValue(null);
});

describe('usePhotos', () => {
  it('initializes with default state', () => {
    const { result } = renderHook(() => usePhotos());
    expect(result.current.photos).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.uploadStatus).toBe('');
  });

  it('loads library path on mount', () => {
    invoke.mockResolvedValueOnce('/Users/test/Pictures/Terra');
    renderHook(() => usePhotos());
    expect(invoke).toHaveBeenCalledWith('get_library_path_command');
  });

  it('loadPhotosFromDatabase fetches the first page and processes results', async () => {
    invoke.mockResolvedValueOnce('/library') // get_library_path_command
      .mockResolvedValueOnce({
        photos: [
          { path: '/p/1.jpg', name: '1.jpg', date_taken: 1700000000, is_favorite: false },
        ],
        next_cursor: null,
      });

    const { result } = renderHook(() => usePhotos());

    await act(async () => {
      await result.current.loadPhotosFromDatabase();
    });

    expect(invoke).toHaveBeenCalledWith(
      'get_photos_page',
      expect.objectContaining({ filter: { kind: 'all' }, cursor: null }),
    );
    expect(result.current.photos.length).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('handleUploadPhotos cancels when no files selected', async () => {
    open.mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePhotos());

    await act(async () => {
      await result.current.handleUploadPhotos();
    });

    expect(result.current.uploadStatus).toBe('');
  });

  it('handleToggleFavorite optimistically updates photo', async () => {
    invoke.mockResolvedValueOnce('/library') // get_library_path_command
      .mockResolvedValueOnce({
        photos: [
          { path: '/p/1.jpg', name: '1.jpg', date_taken: 1700000000, is_favorite: false },
        ],
        next_cursor: null,
      });

    const { result } = renderHook(() => usePhotos());

    await act(async () => {
      await result.current.loadPhotosFromDatabase();
    });

    invoke.mockResolvedValueOnce(undefined); // toggle_favorite

    const setSelectedPhoto = vi.fn();
    await act(async () => {
      await result.current.handleToggleFavorite(
        result.current.photos[0],
        null,
        setSelectedPhoto
      );
    });

    expect(result.current.photos[0].is_favorite).toBe(true);
    expect(invoke).toHaveBeenCalledWith('toggle_favorite', { path: '/p/1.jpg', isFavorite: true });
  });

  it('setStatusWithTimeout clears status after timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePhotos());

    act(() => {
      result.current.setStatusWithTimeout('test message', 1000);
    });
    expect(result.current.uploadStatus).toBe('test message');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.uploadStatus).toBe('');

    vi.useRealTimers();
  });
});
