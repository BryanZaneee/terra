import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCleanup } from './useCleanup';

const { invoke } = await import('@tauri-apps/api/core');
const { listen } = await import('@tauri-apps/api/event');

const deps = {
  loadPhotosFromDatabase: vi.fn(),
  setStatusWithTimeout: vi.fn(),
  setError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue([]);
  listen.mockResolvedValue(vi.fn()); // returns unlisten
});

describe('useCleanup', () => {
  it('initializes with default state', () => {
    const { result } = renderHook(() => useCleanup(deps));
    expect(result.current.showDuplicateScan).toBe(false);
    expect(result.current.showScreenshotScan).toBe(false);
    expect(result.current.showDuplicateReview).toBe(false);
    expect(result.current.duplicateGroups).toEqual([]);
    expect(result.current.screenshots).toEqual([]);
    expect(result.current.archivedPhotos).toEqual([]);
  });

  it('runs cleanup_old_archives on mount', () => {
    renderHook(() => useCleanup(deps));
    expect(invoke).toHaveBeenCalledWith('cleanup_old_archives');
  });

  it('handleScanForDuplicates scans and loads groups', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // cleanup_old_archives
      .mockResolvedValueOnce(undefined) // scan_for_duplicates
      .mockResolvedValueOnce([{ group_id: 1, photos: [] }]); // get_duplicate_groups

    const { result } = renderHook(() => useCleanup(deps));

    await act(async () => {
      await result.current.handleScanForDuplicates();
    });

    expect(invoke).toHaveBeenCalledWith('scan_for_duplicates');
    expect(result.current.scanPhase).toBe('complete');
    expect(result.current.duplicateGroups).toEqual([{ group_id: 1, photos: [] }]);
  });

  it('handleDuplicateScanComplete transitions to review', () => {
    const { result } = renderHook(() => useCleanup(deps));

    act(() => {
      result.current.handleDuplicateScanComplete();
    });

    expect(result.current.showDuplicateScan).toBe(false);
    expect(result.current.showDuplicateReview).toBe(true);
  });

  it('handleArchivePhotos calls invoke and reloads', async () => {
    invoke
      .mockResolvedValueOnce(undefined) // cleanup_old_archives
      .mockResolvedValueOnce(undefined); // archive_photos

    const { result } = renderHook(() => useCleanup(deps));

    await act(async () => {
      await result.current.handleArchivePhotos(['/a.jpg', '/b.jpg']);
    });

    expect(invoke).toHaveBeenCalledWith('archive_photos', { paths: ['/a.jpg', '/b.jpg'] });
    expect(deps.setStatusWithTimeout).toHaveBeenCalledWith('Archived 2 photos');
    expect(deps.loadPhotosFromDatabase).toHaveBeenCalled();
  });

  it('handleOpenArchive loads archived photos and shows view', async () => {
    const mockArchived = [{ photo: { path: '/a.jpg' }, days_until_deletion: 10 }];
    invoke
      .mockResolvedValueOnce(undefined) // cleanup_old_archives
      .mockResolvedValueOnce(mockArchived); // get_archived_photos

    const { result } = renderHook(() => useCleanup(deps));

    await act(async () => {
      result.current.handleOpenArchive();
    });

    expect(result.current.showArchive).toBe(true);
    expect(invoke).toHaveBeenCalledWith('get_archived_photos');
  });
});
