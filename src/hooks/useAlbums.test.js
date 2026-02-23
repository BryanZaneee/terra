import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAlbums } from './useAlbums';

const { invoke } = await import('@tauri-apps/api/core');

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue([]);
});

describe('useAlbums', () => {
  it('initializes with empty albums', () => {
    const { result } = renderHook(() => useAlbums());
    expect(result.current.albums).toEqual([]);
  });

  it('loadAlbums fetches albums from backend', async () => {
    const mockAlbums = [{ id: 1, name: 'Vacation', count: 5 }];
    invoke.mockResolvedValueOnce(mockAlbums);

    const { result } = renderHook(() => useAlbums());

    await act(async () => {
      await result.current.loadAlbums();
    });

    expect(invoke).toHaveBeenCalledWith('get_albums');
    expect(result.current.albums).toEqual(mockAlbums);
  });

  it('handleCreateAlbum creates album and reloads', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // create_album
      .mockResolvedValueOnce([{ id: 1, name: 'New', count: 0 }]); // get_albums

    const { result } = renderHook(() => useAlbums());

    await act(async () => {
      await result.current.handleCreateAlbum('New');
    });

    expect(invoke).toHaveBeenCalledWith('create_album', { name: 'New' });
  });

  it('handleAddToAlbum adds photos and calls onComplete', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // add_to_album
      .mockResolvedValueOnce([]); // get_albums reload

    const onComplete = vi.fn();
    const { result } = renderHook(() => useAlbums());

    await act(async () => {
      await result.current.handleAddToAlbum(1, new Set(['/a.jpg', '/b.jpg']), onComplete);
    });

    expect(invoke).toHaveBeenCalledWith('add_to_album', {
      albumId: 1,
      photoPaths: ['/a.jpg', '/b.jpg'],
    });
    expect(onComplete).toHaveBeenCalledWith(2);
  });
});
