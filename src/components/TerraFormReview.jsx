import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Eye, Check, Archive, SkipForward, RotateCcw } from 'lucide-react';
import { processPhotos } from '../utils/photoHelpers';

const SWIPE_THRESHOLD = 120;
const EXIT_DISTANCE = 1100;
const EXIT_DURATION_MS = 240;
const ROTATION_DIVISOR = 22;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const TerraFormReview = ({ isOpen, onClose }) => {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState({ x: 0, animating: false });

  const dragRef = useRef({ active: false, startX: 0, startY: 0, lastX: 0, pointerId: null });

  const currentPhoto = photos[currentIndex];
  const nextPhoto = photos[currentIndex + 1];
  const reviewedCount = useMemo(
    () => actions.filter((a) => a === 'keep' || a === 'archive').length,
    [actions]
  );
  const done = !loading && photos.length > 0 && currentIndex >= photos.length;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    invoke('get_unreviewed_photos')
      .then((result) => {
        if (cancelled) return;
        const processed = shuffleInPlace(processPhotos(result));
        setPhotos(processed);
        setCurrentIndex(0);
        setActions([]);
        setDrag({ x: 0, animating: false });
      })
      .catch((err) => console.error('Failed to load unreviewed photos:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Preload the next image so the swipe-to-next feels instant.
  useEffect(() => {
    if (!nextPhoto) return;
    const img = new Image();
    img.src = nextPhoto.url;
  }, [nextPhoto]);

  const exitWith = useCallback((direction) => {
    setDrag({ x: direction === 'right' ? EXIT_DISTANCE : -EXIT_DISTANCE, animating: true });
    return new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS));
  }, []);

  const handleKeep = useCallback(async () => {
    if (!currentPhoto || drag.animating) return;
    const photo = currentPhoto;
    setActions((prev) => [...prev, 'keep']);
    invoke('mark_photo_reviewed', { path: photo.path }).catch((err) => {
      console.error('Failed to mark as reviewed:', err);
    });
    await exitWith('right');
    setCurrentIndex((i) => i + 1);
    setDrag({ x: 0, animating: false });
  }, [currentPhoto, drag.animating, exitWith]);

  const handleArchive = useCallback(async () => {
    if (!currentPhoto || drag.animating) return;
    const photo = currentPhoto;
    setActions((prev) => [...prev, 'archive']);
    invoke('archive_photos', { paths: [photo.path] }).catch((err) => {
      console.error('Failed to archive photo:', err);
    });
    await exitWith('left');
    setCurrentIndex((i) => i + 1);
    setDrag({ x: 0, animating: false });
  }, [currentPhoto, drag.animating, exitWith]);

  const handleSkip = useCallback(() => {
    if (!currentPhoto || drag.animating) return;
    setActions((prev) => [...prev, 'skip']);
    setCurrentIndex((i) => i + 1);
    setDrag({ x: 0, animating: false });
  }, [currentPhoto, drag.animating]);

  const handleUndo = useCallback(() => {
    if (currentIndex === 0 || drag.animating) return;
    const prevIdx = currentIndex - 1;
    const prevAction = actions[prevIdx];
    const prevPhoto = photos[prevIdx];
    if (!prevPhoto) return;
    if (prevAction === 'keep') {
      invoke('unmark_photo_reviewed', { path: prevPhoto.path }).catch((err) =>
        console.error('Failed to undo keep:', err)
      );
    } else if (prevAction === 'archive') {
      invoke('restore_photos', { paths: [prevPhoto.path] }).catch((err) =>
        console.error('Failed to undo archive:', err)
      );
    }
    setActions((prev) => prev.slice(0, -1));
    setCurrentIndex(prevIdx);
    setDrag({ x: 0, animating: false });
  }, [currentIndex, actions, photos, drag.animating]);

  // Keyboard
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (loading || done || drag.animating) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          handleKeep();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleArchive();
          break;
        case ' ':
          e.preventDefault();
          handleSkip();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, done, drag.animating, handleKeep, handleArchive, handleSkip, handleUndo, onClose]);

  // Pointer handlers for swipe
  const onPointerDown = (e) => {
    if (drag.animating || !currentPhoto) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: 0,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    dragRef.current.lastX = dx;
    setDrag({ x: dx, animating: false });
  };

  const onPointerUp = (e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const x = dragRef.current.lastX;
    if (x > SWIPE_THRESHOLD) {
      handleKeep();
    } else if (x < -SWIPE_THRESHOLD) {
      handleArchive();
    } else {
      // Snap back
      setDrag({ x: 0, animating: true });
      setTimeout(() => setDrag({ x: 0, animating: false }), 200);
    }
  };

  if (!isOpen) return null;

  const totalInitial = photos.length;
  const remaining = Math.max(0, photos.length - currentIndex);
  const progressPct = totalInitial > 0 ? (reviewedCount / totalInitial) * 100 : 0;

  const dragMagnitude = Math.min(Math.abs(drag.x), SWIPE_THRESHOLD) / SWIPE_THRESHOLD;
  const keepOverlayOpacity = drag.x > 30 ? Math.min(1, drag.x / SWIPE_THRESHOLD) : 0;
  const archiveOverlayOpacity = drag.x < -30 ? Math.min(1, -drag.x / SWIPE_THRESHOLD) : 0;

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
              {loading
                ? 'Loading…'
                : totalInitial === 0
                ? 'Nothing to review'
                : done
                ? `All caught up — ${reviewedCount} reviewed`
                : `${remaining} remaining${reviewedCount > 0 ? ` · ${reviewedCount} reviewed` : ''}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Progress bar */}
        {totalInitial > 0 && (
          <div className="px-6 py-2 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs font-mono text-white/40">
                {reviewedCount} / {totalInitial}
              </span>
            </div>
          </div>
        )}

        {/* Card stage */}
        <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden select-none">
          {loading ? (
            <div className="flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"></div>
              <p className="text-white/50 text-sm mt-4">Loading photos…</p>
            </div>
          ) : totalInitial === 0 || done ? (
            <div className="flex flex-col items-center justify-center text-white/40">
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
          ) : (
            <>
              {/* Next card peeking from behind */}
              {nextPhoto && (
                <div
                  className="absolute inset-6 flex items-center justify-center pointer-events-none"
                  style={{
                    transform: `scale(${0.94 + dragMagnitude * 0.05})`,
                    opacity: 0.35 + dragMagnitude * 0.45,
                    transition: drag.animating ? 'transform 240ms ease-out, opacity 240ms ease-out' : 'none',
                  }}
                >
                  <PhotoCard photo={nextPhoto} dim />
                </div>
              )}

              {/* Active card */}
              {currentPhoto && (
                <div
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className="absolute inset-6 flex items-center justify-center cursor-grab active:cursor-grabbing"
                  style={{
                    transform: `translateX(${drag.x}px) rotate(${drag.x / ROTATION_DIVISOR}deg)`,
                    transition: drag.animating ? `transform ${EXIT_DURATION_MS}ms ease-out` : 'none',
                    touchAction: 'none',
                  }}
                >
                  <PhotoCard photo={currentPhoto}>
                    {keepOverlayOpacity > 0 && (
                      <SwipeBadge label="KEEP" tone="emerald" rotation={-12} opacity={keepOverlayOpacity} side="left" />
                    )}
                    {archiveOverlayOpacity > 0 && (
                      <SwipeBadge label="ARCHIVE" tone="rose" rotation={12} opacity={archiveOverlayOpacity} side="right" />
                    )}
                  </PhotoCard>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action bar */}
        {!loading && !done && totalInitial > 0 && (
          <div className="border-t border-white/10 p-6">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleUndo}
                disabled={currentIndex === 0}
                className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors disabled:opacity-20"
                title="Undo (Cmd+Z)"
              >
                <RotateCcw size={20} />
                <span className="text-[10px] uppercase tracking-wider">Undo</span>
              </button>

              <button
                onClick={handleArchive}
                className="flex flex-col items-center gap-1 px-6 py-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 transition-colors"
                title="Archive (←)"
              >
                <Archive size={24} />
                <span className="text-[10px] uppercase tracking-wider">Archive</span>
              </button>

              <button
                onClick={handleKeep}
                className="flex flex-col items-center gap-1 px-8 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 transition-colors"
                title="Keep (→)"
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

            <div className="mt-4 flex items-center justify-center gap-5 text-[10px] text-white/30 font-mono">
              <span>← Archive</span>
              <span>→ Keep</span>
              <span>Space Skip</span>
              <span>⌘Z Undo</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PhotoCard = ({ photo, children, dim = false }) => (
  <div className="relative max-h-full max-w-full flex items-center justify-center">
    <img
      src={photo.url}
      alt={photo.name}
      draggable={false}
      className={`max-h-[calc(100vh-260px)] max-w-full object-contain rounded-2xl shadow-2xl border border-white/10 ${
        dim ? 'opacity-90' : ''
      }`}
    />
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center bg-black/60 backdrop-blur px-4 py-2 rounded-lg pointer-events-none whitespace-nowrap">
      <p className="text-sm font-mono text-white/90 truncate max-w-[60vw]">{photo.name}</p>
      <p className="text-xs text-white/50 mt-0.5">
        {photo.date
          ? new Date(photo.date * 1000).toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'Unknown date'}
        {photo.width > 0 && ` • ${photo.width}×${photo.height}`}
      </p>
    </div>
    {children}
  </div>
);

const SwipeBadge = ({ label, tone, rotation, opacity, side }) => {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-400 text-emerald-400'
      : 'border-rose-400 text-rose-400';
  const sideClass = side === 'left' ? 'left-8 top-8' : 'right-8 top-8';
  return (
    <div
      className={`absolute ${sideClass} px-5 py-2 rounded-lg border-4 ${toneClasses} text-3xl font-extrabold tracking-widest pointer-events-none`}
      style={{
        transform: `rotate(${rotation}deg)`,
        opacity,
      }}
    >
      {label}
    </div>
  );
};

export default TerraFormReview;
