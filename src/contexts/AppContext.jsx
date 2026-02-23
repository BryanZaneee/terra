import { createContext, useContext, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePhotos } from '../hooks/usePhotos';
import { useAlbums } from '../hooks/useAlbums';
import { useTags } from '../hooks/useTags';
import { useCleanup } from '../hooks/useCleanup';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const photosHook = usePhotos();
  const albumsHook = useAlbums();
  const tagsHook = useTags();
  const cleanupHook = useCleanup({
    loadPhotosFromDatabase: photosHook.loadPhotosFromDatabase,
    setStatusWithTimeout: photosHook.setStatusWithTimeout,
    setError: photosHook.setError,
  });

  // Load initial data on mount
  useEffect(() => {
    photosHook.loadPhotosFromDatabase();
    albumsHook.loadAlbums();
    tagsHook.loadTags();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    ...photosHook,
    ...albumsHook,
    ...tagsHook,
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
