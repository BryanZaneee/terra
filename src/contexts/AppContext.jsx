import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePhotos } from '../hooks/usePhotos';
import { useCleanup } from '../hooks/useCleanup';

export const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [albums, setAlbums] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [thumbCacheRoot, setThumbCacheRoot] = useState(null);
  // Sidebar count cache (PAGINATION_PLAN.md, P.5). `null` until the first
  // get_view_counts resolves; sidebar falls back to photos.length while we
  // wait so the header doesn't flash empty on cold start.
  const [counts, setCounts] = useState(null);

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await invoke('get_view_counts'));
    } catch (err) {
      console.error('Failed to refresh view counts:', err);
    }
  }, []);

  // Pass refreshCounts so usePhotos can refresh the badge cache after
  // upload/toggle-favorite/delete. Defining refreshCounts above this line
  // avoids the temporal-dead-zone trap.
  const photosHook = usePhotos({ refreshCounts });

  const loadAlbums = useCallback(async () => {
    try {
      setAlbums(await invoke('get_albums'));
    } catch (err) {
      console.error('Failed to load albums:', err);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      setTags(await invoke('get_all_tags'));
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  }, []);

  const handleCreateAlbum = useCallback(async (name) => {
    try {
      await invoke('create_album', { name });
      loadAlbums();
    } catch (err) {
      console.error('Failed to create album:', err);
    }
  }, [loadAlbums]);

  const handleAddToAlbum = useCallback(async (albumId, selectedPhotos, onComplete) => {
    try {
      const paths = Array.from(selectedPhotos);
      await invoke('add_to_album', { albumId, photoPaths: paths });
      loadAlbums();
      if (onComplete) onComplete(paths.length);
    } catch (err) {
      console.error('Failed to add to album:', err);
      throw err;
    }
  }, [loadAlbums]);

  const cleanupHook = useCleanup({
    loadPhotosFromDatabase: photosHook.loadPhotosFromDatabase,
    setStatusWithTimeout: photosHook.setStatusWithTimeout,
    setError: photosHook.setError,
    refreshCounts,
  });

  // Load initial data on mount
  useEffect(() => {
    photosHook.loadPhotosFromDatabase();
    loadAlbums();
    loadTags();
    refreshCounts();
    invoke('get_thumb_cache_root')
      .then(setThumbCacheRoot)
      .catch((err) => console.error('Failed to get thumb cache root:', err));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    ...photosHook,
    albums,
    loadAlbums,
    handleCreateAlbum,
    handleAddToAlbum,
    tags,
    selectedTagIds,
    setSelectedTagIds,
    loadTags,
    thumbCacheRoot,
    counts,
    refreshCounts,
    ...cleanupHook,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
