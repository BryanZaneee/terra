import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTags } from './useTags';

const { invoke } = await import('@tauri-apps/api/core');

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue([]);
});

describe('useTags', () => {
  it('initializes with empty tags and no selected ids', () => {
    const { result } = renderHook(() => useTags());
    expect(result.current.tags).toEqual([]);
    expect(result.current.selectedTagIds).toEqual([]);
  });

  it('loadTags fetches tags from backend', async () => {
    const mockTags = [{ id: 1, name: 'Nature', color: '#00ff00', count: 3 }];
    invoke.mockResolvedValueOnce(mockTags);

    const { result } = renderHook(() => useTags());

    await act(async () => {
      await result.current.loadTags();
    });

    expect(invoke).toHaveBeenCalledWith('get_all_tags');
    expect(result.current.tags).toEqual(mockTags);
  });

  it('setSelectedTagIds updates selected tag ids', () => {
    const { result } = renderHook(() => useTags());

    act(() => {
      result.current.setSelectedTagIds([1, 2]);
    });

    expect(result.current.selectedTagIds).toEqual([1, 2]);
  });
});
