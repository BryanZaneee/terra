import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CONFIG } from '../config';

export function useCleanup({ loadPhotosFromDatabase, setStatusWithTimeout, setError }) {
  const [showDuplicateScan, setShowDuplicateScan] = useState(false);
  const [showScreenshotScan, setShowScreenshotScan] = useState(false);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);
  const [showScreenshotReview, setShowScreenshotReview] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [scanProgress, setScanProgress] = useState({ total: 0, processed: 0 });
  const [scanPhase, setScanPhase] = useState('');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [archivedPhotos, setArchivedPhotos] = useState([]);

  // Run archive cleanup on startup
  useEffect(() => {
    invoke('cleanup_old_archives').catch(err => {
      console.error("Failed to cleanup archives:", err);
    });
  }, []);

  const handleScanForDuplicates = useCallback(async () => {
    setShowDuplicateScan(true);
    setScanProgress({ total: 0, processed: 0 });
    setScanPhase('hashing');

    const unlisten = await listen('scan_progress', (event) => {
      setScanProgress({ total: event.payload.total, processed: event.payload.processed });
      setScanPhase(event.payload.phase);
    });

    try {
      await invoke('scan_for_duplicates');
      const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
      setDuplicateGroups(groups);
      setScanPhase('complete');
    } catch (err) {
      console.error("Failed to scan for duplicates:", err);
      setShowDuplicateScan(false);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to scan for duplicates');
    } finally {
      unlisten();
    }
  }, [setError]);

  const handleDuplicateScanComplete = useCallback(() => {
    setShowDuplicateScan(false);
    setShowDuplicateReview(true);
  }, []);

  const handleScanForScreenshots = useCallback(async () => {
    setShowScreenshotScan(true);
    setScanProgress({ total: 0, processed: 0 });
    setScanPhase('analyzing');

    const unlisten = await listen('screenshot_scan_progress', (event) => {
      setScanProgress({ total: event.payload.total, processed: event.payload.processed });
      setScanPhase(event.payload.phase);
    });

    try {
      const result = await invoke('scan_for_screenshots');
      setScreenshots(result);
      setScanPhase('complete');
    } catch (err) {
      console.error("Failed to scan for screenshots:", err);
      setShowScreenshotScan(false);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to scan for screenshots');
    } finally {
      unlisten();
    }
  }, [setError]);

  const handleScreenshotScanComplete = useCallback(() => {
    setShowScreenshotScan(false);
    setShowScreenshotReview(true);
  }, []);

  const handleArchivePhotos = useCallback(async (paths) => {
    try {
      await invoke('archive_photos', { paths });
      setStatusWithTimeout(`Archived ${paths.length} photos`);
      loadPhotosFromDatabase();
      if (showDuplicateReview) {
        const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
        setDuplicateGroups(groups);
      }
      if (showScreenshotReview) {
        const result = await invoke('get_screenshots');
        setScreenshots(result);
      }
    } catch (err) {
      console.error("Failed to archive photos:", err);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to archive photos');
    }
  }, [loadPhotosFromDatabase, setStatusWithTimeout, setError, showDuplicateReview, showScreenshotReview]);

  const handleRestorePhotos = useCallback(async (paths) => {
    try {
      await invoke('restore_photos', { paths });
      setStatusWithTimeout(`Restored ${paths.length} photos`);
      loadPhotosFromDatabase();
      loadArchivedPhotos();
    } catch (err) {
      console.error("Failed to restore photos:", err);
      setError(typeof err === 'string' ? err : err?.message ?? 'Failed to restore photos');
    }
  }, [loadPhotosFromDatabase, setStatusWithTimeout, setError]);

  const loadArchivedPhotos = useCallback(async () => {
    try {
      const result = await invoke('get_archived_photos');
      setArchivedPhotos(result);
    } catch (err) {
      console.error("Failed to load archived photos:", err);
    }
  }, []);

  const handleOpenArchive = useCallback(() => {
    loadArchivedPhotos();
    setShowArchive(true);
  }, [loadArchivedPhotos]);

  const refreshDuplicateGroups = useCallback(async () => {
    try {
      const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
      setDuplicateGroups(groups);
    } catch (err) {
      console.error("Failed to refresh duplicate groups:", err);
    }
  }, []);

  const refreshScreenshots = useCallback(async () => {
    try {
      const result = await invoke('get_screenshots');
      setScreenshots(result);
    } catch (err) {
      console.error("Failed to refresh screenshots:", err);
    }
  }, []);

  return {
    showDuplicateScan,
    showScreenshotScan,
    showDuplicateReview,
    setShowDuplicateReview,
    showScreenshotReview,
    setShowScreenshotReview,
    showArchive,
    setShowArchive,
    scanProgress,
    scanPhase,
    duplicateGroups,
    screenshots,
    archivedPhotos,
    handleScanForDuplicates,
    handleDuplicateScanComplete,
    handleScanForScreenshots,
    handleScreenshotScanComplete,
    handleArchivePhotos,
    handleRestorePhotos,
    handleOpenArchive,
    refreshDuplicateGroups,
    refreshScreenshots,
    loadArchivedPhotos,
  };
}
