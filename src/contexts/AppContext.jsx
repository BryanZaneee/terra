import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePhotos } from '../hooks/usePhotos';
import { useCleanup } from '../hooks/useCleanup';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const photosHook = usePhotos();

  const [albums, setAlbums] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);

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
  });

  // Load initial data on mount
  useEffect(() => {
    photosHook.loadPhotosFromDatabase();
    loadAlbums();
    loadTags();
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
