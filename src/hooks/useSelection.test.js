import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection } from './useSelection';

const photos = [
  { path: '/a.jpg' },
  { path: '/b.jpg' },
  { path: '/c.jpg' },
  { path: '/d.jpg' },
];

describe('useSelection', () => {
  it('initializes with empty selection and mode off', () => {
    const { result } = renderHook(() => useSelection(photos));
    expect(result.current.selectedPhotos.size).toBe(0);
    expect(result.current.selectionMode).toBe(false);
  });

  it('toggleSelection adds and removes photos', () => {
    const { result } = renderHook(() => useSelection(photos));

    act(() => result.current.toggleSelection('/a.jpg'));
    expect(result.current.selectedPhotos.has('/a.jpg')).toBe(true);

    act(() => result.current.toggleSelection('/a.jpg'));
    expect(result.current.selectedPhotos.has('/a.jpg')).toBe(false);
  });

  it('cmd+click enters selection mode and toggles', () => {
    const setSelectedPhoto = vi.fn();
    const { result } = renderHook(() => useSelection(photos));

    act(() => {
      result.current.handlePhotoClick(
        photos[0],
        { metaKey: true, ctrlKey: false, shiftKey: false, stopPropagation: vi.fn() },
        setSelectedPhoto
      );
    });

    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedPhotos.has('/a.jpg')).toBe(true);
    expect(setSelectedPhoto).not.toHaveBeenCalled();
  });

  it('shift+click selects a range', () => {
    const setSelectedPhoto = vi.fn();
    const { result } = renderHook(() => useSelection(photos));

    // First cmd+click to set lastSelectedPath
    act(() => {
      result.current.handlePhotoClick(
        photos[0],
        { metaKey: true, ctrlKey: false, shiftKey: false, stopPropagation: vi.fn() },
        setSelectedPhoto
      );
    });

    // Then shift+click on photos[2]
    act(() => {
      result.current.handlePhotoClick(
        photos[2],
        { metaKey: false, ctrlKey: false, shiftKey: true, stopPropagation: vi.fn() },
        setSelectedPhoto
      );
    });

    expect(result.current.selectedPhotos.has('/a.jpg')).toBe(true);
    expect(result.current.selectedPhotos.has('/b.jpg')).toBe(true);
    expect(result.current.selectedPhotos.has('/c.jpg')).toBe(true);
    expect(result.current.selectedPhotos.has('/d.jpg')).toBe(false);
  });

  it('normal click in non-selection mode opens photo', () => {
    const setSelectedPhoto = vi.fn();
    const { result } = renderHook(() => useSelection(photos));

    act(() => {
      result.current.handlePhotoClick(
        photos[1],
        { metaKey: false, ctrlKey: false, shiftKey: false, stopPropagation: vi.fn() },
        setSelectedPhoto
      );
    });

    expect(setSelectedPhoto).toHaveBeenCalledWith(photos[1]);
    expect(result.current.selectionMode).toBe(false);
  });

  it('clearSelection resets everything', () => {
    const { result } = renderHook(() => useSelection(photos));

    act(() => result.current.toggleSelection('/a.jpg'));
    act(() => result.current.setSelectionMode(true));

    act(() => result.current.clearSelection());

    expect(result.current.selectedPhotos.size).toBe(0);
    expect(result.current.selectionMode).toBe(false);
  });
});
