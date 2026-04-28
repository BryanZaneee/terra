import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { X, Settings, FolderOpen, AlertTriangle, Sparkles, Image as ImageIcon } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, libraryPath, onLibraryPathChange, onPhotosChanged }) => {
  const [currentPath, setCurrentPath] = useState(libraryPath || '');
  const [saving, setSaving] = useState(false);

  const [enrichRunning, setEnrichRunning] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ processed: 0, total: 0 });
  const [enrichResult, setEnrichResult] = useState(null);
  const [enrichError, setEnrichError] = useState(null);

  const [thumbRunning, setThumbRunning] = useState(false);
  const [thumbProgress, setThumbProgress] = useState({ processed: 0, total: 0 });
  const [thumbResult, setThumbResult] = useState(null);
  const [thumbError, setThumbError] = useState(null);

  useEffect(() => {
    setCurrentPath(libraryPath || '');
  }, [libraryPath]);

  useEffect(() => {
    if (!enrichRunning) return;
    let unlisten;
    listen('metadata_enrich_progress', (event) => {
      setEnrichProgress(event.payload);
    }).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, [enrichRunning]);

  useEffect(() => {
    if (!thumbRunning) return;
    let unlisten;
    listen('thumbnail_progress', (event) => {
      setThumbProgress(event.payload);
    }).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, [thumbRunning]);

  if (!isOpen) return null;

  const handleChangePath = async () => {
    try {
      const selected = await open({ directory: true });
      if (!selected) return;

      setSaving(true);
      await invoke('set_library_path', { path: selected });
      setCurrentPath(selected);
      if (onLibraryPathChange) onLibraryPathChange(selected);
    } catch (err) {
      console.error('Failed to set library path:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEnrichMetadata = async () => {
    setEnrichRunning(true);
    setEnrichResult(null);
    setEnrichError(null);
    setEnrichProgress({ processed: 0, total: 0 });
    try {
      const count = await invoke('enrich_all_metadata');
      setEnrichResult(count);
      onPhotosChanged?.();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Failed to enrich metadata';
      setEnrichError(msg);
    } finally {
      setEnrichRunning(false);
    }
  };

  const handleGenerateThumbnails = async () => {
    setThumbRunning(true);
    setThumbResult(null);
    setThumbError(null);
    setThumbProgress({ processed: 0, total: 0 });
    try {
      const count = await invoke('generate_missing_thumbnails');
      setThumbResult(count);
      onPhotosChanged?.();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message ?? 'Failed to generate thumbnails';
      setThumbError(msg);
    } finally {
      setThumbRunning(false);
    }
  };

  const enrichPercent = enrichProgress.total > 0
    ? Math.round((enrichProgress.processed / enrichProgress.total) * 100)
    : 0;
  const thumbPercent = thumbProgress.total > 0
    ? Math.round((thumbProgress.processed / thumbProgress.total) * 100)
    : 0;

  const exiftoolMissing = enrichError && /exiftool/i.test(enrichError);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-emerald-400" />
            Settings
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Library Path */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Library Storage Path</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono truncate">
                {currentPath || 'Loading...'}
              </div>
              <button
                onClick={handleChangePath}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white/80 hover:text-white transition-colors disabled:opacity-50"
              >
                <FolderOpen size={16} />
                Change
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs text-white/40">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-yellow-500/60" />
              <span>New uploads will go to the new path. Existing photos stay in their current location.</span>
            </div>
          </div>

          {/* Thumbnails */}
          <div className="pt-4 border-t border-white/10">
            <label className="block text-sm font-medium text-white/70 mb-2">Thumbnails</label>
            <p className="text-xs text-white/40 mb-3">
              Generate cached 256² thumbnails for each photo. Required for snappy gallery scrolling on large libraries; videos and undecodable HEICs are skipped automatically.
            </p>

            <button
              onClick={handleGenerateThumbnails}
              disabled={thumbRunning}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 hover:border-emerald-400/50 rounded-lg text-sm text-emerald-200 transition-colors disabled:opacity-50"
            >
              <ImageIcon size={16} />
              {thumbRunning ? 'Generating…' : 'Generate Missing Thumbnails'}
            </button>

            {thumbRunning && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs font-mono text-white/50">
                  <span>{thumbProgress.processed} / {thumbProgress.total || '?'}</span>
                  <span>{thumbPercent}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${thumbPercent}%` }}
                  />
                </div>
              </div>
            )}

            {thumbResult != null && !thumbRunning && (
              <div className="mt-3 text-xs text-emerald-400 font-mono">
                Generated {thumbResult} thumbnail{thumbResult === 1 ? '' : 's'}.
              </div>
            )}

            {thumbError && !thumbRunning && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/20 text-xs text-red-300 font-mono break-words">
                <AlertTriangle size={14} className="inline-block mr-1 -mt-0.5 text-red-400" />
                {thumbError}
              </div>
            )}
          </div>

          {/* Photo Metadata Enrichment */}
          <div className="pt-4 border-t border-white/10">
            <label className="block text-sm font-medium text-white/70 mb-2">Photo Metadata</label>
            <p className="text-xs text-white/40 mb-3">
              Extract camera, lens, ISO, aperture, shutter speed, focal length, and video codec/duration from your photos to enable richer filtering. Uses <code className="font-mono text-emerald-400/80">exiftool</code> via a local Python script.
            </p>

            <button
              onClick={handleEnrichMetadata}
              disabled={enrichRunning}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 hover:border-emerald-400/50 rounded-lg text-sm text-emerald-200 transition-colors disabled:opacity-50"
            >
              <Sparkles size={16} />
              {enrichRunning ? 'Enriching…' : 'Enrich All Photos'}
            </button>

            {enrichRunning && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs font-mono text-white/50">
                  <span>{enrichProgress.processed} / {enrichProgress.total || '?'}</span>
                  <span>{enrichPercent}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${enrichPercent}%` }}
                  />
                </div>
              </div>
            )}

            {enrichResult != null && !enrichRunning && (
              <div className="mt-3 text-xs text-emerald-400 font-mono">
                Enriched {enrichResult} photo{enrichResult === 1 ? '' : 's'}.
              </div>
            )}

            {enrichError && !enrichRunning && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/20 text-xs text-red-300 font-mono">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
                  <div className="flex-1 break-words">
                    <div>{enrichError}</div>
                    {exiftoolMissing && (
                      <div className="mt-2 text-white/70">
                        Install with: <code className="text-emerald-400">brew install exiftool</code>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
