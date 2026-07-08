import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { CONFIG } from '../config';
import { usePagedPhotos } from './usePagedPhotos';
import { useAsyncGuard } from './useAsyncGuard';

export function usePhotos({ refreshCounts } = {}) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [libraryPath, setLibraryPath] = useState('');

  const statusTimeoutRef = useRef(null);
  const activeRef = useAsyncGuard();

  const paged = usePagedPhotos({ setPhotos, setLoading, setError });

  const setStatusWithTimeout = useCallback((message, duration = CONFIG.STATUS_TIMEOUT_MS) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setUploadStatus(message);
    if (message) {
      statusTimeoutRef.current = setTimeout(() => {
        setUploadStatus('');
        statusTimeoutRef.current = null;
      }, duration);
    }
  }, []);

  useEffect(() => {
    invoke('get_library_path_command').then(setLibraryPath).catch(console.error);
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  const loadPhotosFromDatabase = useCallback(async (filter) => {
    if (!activeRef.current) return;
    await paged.loadFirstPage(filter);
  }, [paged.loadFirstPage, activeRef]);

  const reloadCurrentView = paged.reloadCurrentView;

  const handleUploadPhotos = useCallback(async () => {
    try {
      setUploadStatus('Selecting files...');
      setError(null);

      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Media',
          extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'bmp', 'mp4', 'mov', 'avi', 'webm', 'mkv']
        }]
      });

      if (!selected || selected.length === 0) {
        setUploadStatus('');
        return;
      }

      setLoading(true);
      setUploadStatus(`Uploading ${selected.length} photos...`);

      const uploaded = await invoke('upload_photos', { filePaths: selected });
      await reloadCurrentView();
      refreshCounts?.();

      setStatusWithTimeout(`Successfully uploaded ${uploaded.length} photos!`);
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to upload photos');
      console.error('Upload error:', err);
      setUploadStatus('');
    } finally {
      setLoading(false);
    }
  }, [reloadCurrentView, setStatusWithTimeout, refreshCounts]);

  const handleToggleFavorite = useCallback(async (photo, selectedPhoto, setSelectedPhoto) => {
    try {
      const newStatus = !photo.is_favorite;
      setPhotos(prev => prev.map(p => p.path === photo.path ? { ...p, is_favorite: newStatus } : p));
      if (selectedPhoto && selectedPhoto.path === photo.path) {
        setSelectedPhoto({ ...selectedPhoto, is_favorite: newStatus });
      }
      await invoke('toggle_favorite', { path: photo.path, isFavorite: newStatus });
      refreshCounts?.();
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      reloadCurrentView();
    }
  }, [reloadCurrentView, refreshCounts]);

  const handleDeleteSelected = useCallback(async (selectedPhotos, clearSelection, loadAlbums, loadLocations) => {
    if (!confirm(`Are you sure you want to delete ${selectedPhotos.size} items? This cannot be undone.`)) return;
    try {
      const paths = Array.from(selectedPhotos);
      await invoke('delete_photos', { paths });
      clearSelection();
      loadAlbums();
      loadLocations();
      refreshCounts?.();
      await reloadCurrentView();
    } catch (err) {
      console.error("Failed to delete photos:", err);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to delete items');
    }
  }, [reloadCurrentView, refreshCounts]);

  return {
    photos,
    setPhotos,
    loading,
    setLoading,
    error,
    setError,
    uploadStatus,
    libraryPath,
    setLibraryPath,
    setStatusWithTimeout,
    loadPhotosFromDatabase,
    reloadCurrentView,
    handleUploadPhotos,
    handleToggleFavorite,
    handleDeleteSelected,
    loadNextPage: paged.loadNextPage,
  };
}
