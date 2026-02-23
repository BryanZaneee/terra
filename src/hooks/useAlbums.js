import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useAlbums() {
  const [albums, setAlbums] = useState([]);

  const loadAlbums = useCallback(async () => {
    try {
      const result = await invoke('get_albums');
      setAlbums(result);
    } catch (err) {
      console.error("Failed to load albums:", err);
    }
  }, []);

  const handleCreateAlbum = useCallback(async (name) => {
    try {
      await invoke('create_album', { name });
      loadAlbums();
    } catch (err) {
      console.error("Failed to create album:", err);
    }
  }, [loadAlbums]);

  const handleAddToAlbum = useCallback(async (albumId, selectedPhotos, onComplete) => {
    try {
      const paths = Array.from(selectedPhotos);
      await invoke('add_to_album', { albumId, photoPaths: paths });
      loadAlbums();
      if (onComplete) onComplete(paths.length);
    } catch (err) {
      console.error("Failed to add to album:", err);
      throw err;
    }
  }, [loadAlbums]);

  return {
    albums,
    loadAlbums,
    handleCreateAlbum,
    handleAddToAlbum,
  };
}
