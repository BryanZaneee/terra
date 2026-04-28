import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { processPhotos } from '../utils/photoHelpers';
import { CONFIG } from '../config';
import { usePagedPhotos } from './usePagedPhotos';

export function usePhotos() {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [libraryPath, setLibraryPath] = useState('');

  const statusTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  // Pagination owns the cursor + per-page loading flag; setPhotos/setLoading
  // here remain the single source of truth for the photos list. When
  // CONFIG.USE_PAGINATION is off, the paged hook is dormant — its callbacks
  // are never invoked.
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
    isMountedRef.current = true;
    invoke('get_library_path_command').then(setLibraryPath).catch(console.error);
    return () => {
      isMountedRef.current = false;
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  const loadPhotosFromDatabase = useCallback(async (filter) => {
    if (!isMountedRef.current) return;
    if (CONFIG.USE_PAGINATION) {
      // `filter === undefined` means "reuse the last filter" — exactly what
      // the cleanup hook needs after archive/delete so the user stays on
      // their current view (e.g. Favorites) instead of snapping back to All.
      // P.3: built-in views pass a ViewFilter; album/tag/search/smart
      // collections still bypass this until P.4.
      await paged.loadFirstPage(filter);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke('get_all_photos');
      if (!isMountedRef.current) return;
      setPhotos(processPhotos(result));
    } catch {
      // Database may be empty on first run
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [paged.loadFirstPage]);

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
      await loadPhotosFromDatabase();

      setStatusWithTimeout(`Successfully uploaded ${uploaded.length} photos!`);
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to upload photos');
      console.error('Upload error:', err);
      setUploadStatus('');
    } finally {
      setLoading(false);
    }
  }, [loadPhotosFromDatabase, setStatusWithTimeout]);

  const handleToggleFavorite = useCallback(async (photo, selectedPhoto, setSelectedPhoto) => {
    try {
      const newStatus = !photo.is_favorite;
      setPhotos(prev => prev.map(p => p.path === photo.path ? { ...p, is_favorite: newStatus } : p));
      if (selectedPhoto && selectedPhoto.path === photo.path) {
        setSelectedPhoto({ ...selectedPhoto, is_favorite: newStatus });
      }
      await invoke('toggle_favorite', { path: photo.path, isFavorite: newStatus });
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      loadPhotosFromDatabase();
    }
  }, [loadPhotosFromDatabase]);

  const handleDeleteSelected = useCallback(async (selectedPhotos, clearSelection, loadAlbums, loadLocations) => {
    if (!confirm(`Are you sure you want to delete ${selectedPhotos.size} items? This cannot be undone.`)) return;
    try {
      const paths = Array.from(selectedPhotos);
      await invoke('delete_photos', { paths });
      setPhotos(prev => prev.filter(p => !selectedPhotos.has(p.path)));
      clearSelection();
      loadAlbums();
      loadLocations();
    } catch (err) {
      console.error("Failed to delete photos:", err);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to delete items');
    }
  }, []);

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
    handleUploadPhotos,
    handleToggleFavorite,
    handleDeleteSelected,
    // Pagination surface — meaningful only when CONFIG.USE_PAGINATION is on
    // and the active view is one the paged hook knows how to filter (All,
    // for now). PhotoGrid wires `loadNextPage` to `endReached`.
    loadNextPage: paged.loadNextPage,
    hasMore: paged.hasMore,
    loadingPage: paged.loadingPage,
  };
}
