import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  X, Eye, Check, Archive, SkipForward, RotateCcw,
  ChevronLeft, ChevronRight, Grid
} from 'lucide-react';
import { processPhotos } from '../utils/photoHelpers';

const TerraFormReview = ({ isOpen, onClose }) => {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState('gallery'); // 'gallery' or 'review'
  const [loading, setLoading] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [totalInitial, setTotalInitial] = useState(0);

  useEffect(() => {
    if (isOpen) loadUnreviewed();
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen || mode !== 'review') return;

    const handleKeyDown = (e) => {
      switch (e.key.toLowerCase()) {
        case 'k':
          handleKeep();
          break;
        case 'a':
          handleArchive();
          break;
        case ' ':
          e.preventDefault();
          handleSkip();
          break;
        case 'z':
          if (e.metaKey || e.ctrlKey) {
            handleUndo();
          }
          break;
        case 'arrowleft':
          goToPrevious();
          break;
        case 'arrowright':
          handleSkip();
          break;
        case 'escape':
          if (mode === 'review') {
            setMode('gallery');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, currentIndex, photos, undoStack]);

  const loadUnreviewed = async () => {
    setLoading(true);
    try {
      const result = await invoke('get_unreviewed_photos');
      const processed = processPhotos(result);
      setPhotos(processed);
      setTotalInitial(processed.length);
      setCurrentIndex(0);
      setUndoStack([]);
      setMode('gallery');
    } catch (err) {
      console.error('Failed to load unreviewed photos:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentPhoto = photos[currentIndex];
  const reviewed = totalInitial - photos.length;

  const handleKeep = useCallback(async () => {
    if (!currentPhoto) return;
    try {
      await invoke('mark_photo_reviewed', { path: currentPhoto.path });
      setUndoStack(prev => [...prev, { action: 'keep', photo: currentPhoto, index: currentIndex }]);
      setPhotos(prev => prev.filter((_, i) => i !== currentIndex));
      if (currentIndex >= photos.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    } catch (err) {
      console.error('Failed to mark as reviewed:', err);
    }
  }, [currentPhoto, currentIndex, photos.length]);

  const handleArchive = useCallback(async () => {
    if (!currentPhoto) return;
    try {
      await invoke('archive_photos', { paths: [currentPhoto.path] });
      setUndoStack(prev => [...prev, { action: 'archive', photo: currentPhoto, index: currentIndex }]);
      setPhotos(prev => prev.filter((_, i) => i !== currentIndex));
      if (currentIndex >= photos.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    } catch (err) {
      console.error('Failed to archive photo:', err);
    }
  }, [currentPhoto, currentIndex, photos.length]);

  const handleSkip = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, photos.length]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const lastAction = undoStack[undoStack.length - 1];

    try {
      if (lastAction.action === 'keep') {
        await invoke('unmark_photo_reviewed', { path: lastAction.photo.path });
      } else if (lastAction.action === 'archive') {
        await invoke('restore_photos', { paths: [lastAction.photo.path] });
      }

      // Re-insert photo at original position
      setPhotos(prev => {
        const newPhotos = [...prev];
        newPhotos.splice(lastAction.index, 0, lastAction.photo);
        return newPhotos;
      });
      setCurrentIndex(lastAction.index);
      setUndoStack(prev => prev.slice(0, -1));
    } catch (err) {
      console.error('Failed to undo:', err);
    }
  }, [undoStack]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md animate-in fade-in duration-200 overflow-hidden">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <Eye size={24} className="text-emerald-400" />
              TerraForm Review
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {photos.length} photos to review
              {reviewed > 0 && ` (${reviewed} reviewed)`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {mode === 'review' && (
              <button
                onClick={() => setMode('gallery')}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                title="Gallery View"
              >
                <Grid size={20} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {totalInitial > 0 && (
          <div className="px-6 py-2 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${(reviewed / totalInitial) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-white/40">
                {reviewed} / {totalInitial}
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"></div>
              <p className="text-white/50 text-sm mt-4">Loading photos...</p>
            </div>
          ) : photos.length === 0 ? (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <Check size={64} className="mb-4 text-emerald-400" />
              <p className="text-xl font-medium text-white">All caught up!</p>
              <p className="text-sm mt-2">Every photo in your library has been reviewed.</p>
              <button
                onClick={onClose}
                className="mt-6 px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Back to Library
              </button>
            </div>
          ) : mode === 'gallery' ? (
            /* Gallery Mode */
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {photos.map((photo, i) => (
                  <div
                    key={photo.path}
                    onClick={() => { setCurrentIndex(i); setMode('review'); }}
                    className="relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 border-transparent hover:border-emerald-500/50 transition-all group"
                  >
                    <img
                      src={photo.url}
                      alt={photo.name}
                      loading="lazy"
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                      <p className="text-[10px] font-mono text-white truncate">{photo.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Review Mode */
            <div className="h-full flex flex-col items-center justify-center p-8 relative">
              {/* Navigation Arrows */}
              {currentIndex > 0 && (
                <button
                  onClick={goToPrevious}
                  className="absolute left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              {currentIndex < photos.length - 1 && (
                <button
                  onClick={handleSkip}
                  className="absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                  <ChevronRight size={24} />
                </button>
              )}

              {/* Photo */}
              {currentPhoto && (
                <>
                  <div className="flex-1 flex items-center justify-center max-h-[60vh] w-full">
                    <img
                      src={currentPhoto.url}
                      alt={currentPhoto.name}
                      className="max-h-full max-w-full object-contain rounded-lg shadow-2xl border border-white/10"
                    />
                  </div>

                  {/* Photo Info */}
                  <div className="mt-4 text-center">
                    <p className="text-sm font-mono text-white/80">{currentPhoto.name}</p>
                    <p className="text-xs text-white/40 mt-1">
                      {new Date(currentPhoto.date * 1000).toLocaleDateString(undefined, {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                      })}
                      {currentPhoto.width > 0 && ` \u2022 ${currentPhoto.width}x${currentPhoto.height}`}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-6 flex items-center gap-4">
                    <button
                      onClick={handleUndo}
                      disabled={undoStack.length === 0}
                      className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors disabled:opacity-20"
                      title="Undo (Cmd+Z)"
                    >
                      <RotateCcw size={20} />
                      <span className="text-[10px] uppercase tracking-wider">Undo</span>
                    </button>

                    <button
                      onClick={handleArchive}
                      className="flex flex-col items-center gap-1 px-6 py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 transition-colors"
                      title="Archive (A)"
                    >
                      <Archive size={24} />
                      <span className="text-[10px] uppercase tracking-wider">Archive</span>
                    </button>

                    <button
                      onClick={handleKeep}
                      className="flex flex-col items-center gap-1 px-8 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 transition-colors"
                      title="Keep (K)"
                    >
                      <Check size={28} />
                      <span className="text-[10px] uppercase tracking-wider">Keep</span>
                    </button>

                    <button
                      onClick={handleSkip}
                      className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                      title="Skip (Space)"
                    >
                      <SkipForward size={20} />
                      <span className="text-[10px] uppercase tracking-wider">Skip</span>
                    </button>
                  </div>

                  {/* Keyboard hints */}
                  <div className="mt-3 flex items-center gap-4 text-[10px] text-white/20 font-mono">
                    <span>K = Keep</span>
                    <span>A = Archive</span>
                    <span>Space = Skip</span>
                    <span>Cmd+Z = Undo</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerraFormReview;
