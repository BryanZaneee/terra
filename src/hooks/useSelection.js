import { useState, useCallback } from 'react';

export function useSelection(flatVisiblePhotos) {
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [lastSelectedPath, setLastSelectedPath] = useState(null);

  const toggleSelection = useCallback((path) => {
    setSelectedPhotos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
    setLastSelectedPath(path);
  }, []);

  const handlePhotoClick = useCallback((photo, e, setSelectedPhoto) => {
    // Cmd/Ctrl click: toggle individual
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      if (!selectionMode) setSelectionMode(true);
      toggleSelection(photo.path);
      return;
    }

    // Shift click: range selection
    if (e.shiftKey && lastSelectedPath) {
      e.stopPropagation();
      if (!selectionMode) setSelectionMode(true);

      const currentIndex = flatVisiblePhotos.findIndex(p => p.path === photo.path);
      const lastIndex = flatVisiblePhotos.findIndex(p => p.path === lastSelectedPath);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const range = flatVisiblePhotos.slice(start, end + 1);

        setSelectedPhotos(prev => {
          const newSet = new Set(prev);
          range.forEach(p => newSet.add(p.path));
          return newSet;
        });
        setLastSelectedPath(photo.path);
      }
      return;
    }

    // Normal click
    if (selectionMode) {
      toggleSelection(photo.path);
    } else {
      setSelectedPhoto(photo);
      setLastSelectedPath(photo.path);
    }
  }, [selectionMode, lastSelectedPath, flatVisiblePhotos, toggleSelection]);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedPhotos(new Set());
  }, []);

  return {
    selectedPhotos,
    selectionMode,
    setSelectionMode,
    toggleSelection,
    handlePhotoClick,
    clearSelection,
  };
}
