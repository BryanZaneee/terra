import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Heart, Info, FolderPlus, Tag, Archive, Trash2, FolderOpen,
  ChevronLeft, ChevronRight, MapPin, ExternalLink,
} from 'lucide-react';
import { PhotoTagBar } from './TagManager';
import VideoPlayer from './VideoPlayer';
import Tooltip from './Tooltip';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ─── helpers ────────────────────────────────────────────────────────────────

function humanFileSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatShutter(us) {
  if (!us || us <= 0) return null;
  const sec = us / 1_000_000;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `1/${Math.round(1 / sec)}s`;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function relativeTime(dateSeconds) {
  if (!dateSeconds) return '';
  const now = Date.now();
  const diff = Math.floor((now - dateSeconds * 1000) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

// ─── Info drawer ─────────────────────────────────────────────────────────────

function InfoRow({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">{label}</span>
      <span className="text-white/80 font-mono text-xs break-all">{children}</span>
    </div>
  );
}

function PhotoModalInfoDrawer({ photo, isOpen }) {
  const dateLong = photo.date
    ? new Date(photo.date * 1000).toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  const hasDimensions = photo.width && photo.height && (photo.width > 0 || photo.height > 0);
  const hasGps = photo.latitude != null && photo.longitude != null;

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 w-80 bg-black/60 backdrop-blur-xl border-l border-white/10 overflow-y-auto transition-transform duration-300 ease-in-out z-20 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!isOpen}
    >
      <div className="p-5 flex flex-col gap-5 pt-16">
        <h3 className="text-white font-mono font-bold text-sm uppercase tracking-widest border-b border-white/10 pb-2">
          Photo Info
        </h3>

        <InfoRow label="Name">
          <span className="select-text">{photo.name}</span>
        </InfoRow>

        <InfoRow label="Path">
          <span className="select-text text-white/60">{photo.path}</span>
        </InfoRow>

        <InfoRow label="Date Taken">
          <span>{dateLong}</span>
          {photo.date && (
            <span className="text-white/40 text-[11px]">{relativeTime(photo.date)}</span>
          )}
        </InfoRow>

        <InfoRow label="Dimensions">
          {hasDimensions ? `${photo.width} × ${photo.height}` : '—'}
        </InfoRow>

        <InfoRow label="File Size">
          {humanFileSize(photo.file_size)}
        </InfoRow>

        {hasGps && (
          <InfoRow label="GPS">
            <a
              href={`https://maps.apple.com/?ll=${photo.latitude},${photo.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
            >
              {photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)}
              <ExternalLink size={10} />
            </a>
          </InfoRow>
        )}

        {photo.location_name && (
          <InfoRow label="Location">
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-emerald-400 shrink-0" />
              {photo.location_name}
            </span>
          </InfoRow>
        )}

        <InfoRow label="Source">
          {photo.source_type ?? '—'}
        </InfoRow>

        {(photo.camera_make || photo.camera_model) && (
          <InfoRow label="Camera">
            {[photo.camera_make, photo.camera_model].filter(Boolean).join(' ')}
          </InfoRow>
        )}

        {photo.lens_model && (
          <InfoRow label="Lens">{photo.lens_model}</InfoRow>
        )}

        {(photo.iso != null || photo.aperture != null || photo.shutter_us != null || photo.focal_length_mm != null) && (
          <InfoRow label="Exposure">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {photo.aperture != null && <span>f/{photo.aperture}</span>}
              {photo.shutter_us != null && <span>{formatShutter(photo.shutter_us)}</span>}
              {photo.iso != null && <span>ISO {photo.iso}</span>}
              {photo.focal_length_mm != null && <span>{photo.focal_length_mm}mm</span>}
            </div>
          </InfoRow>
        )}

        {photo.duration_ms != null && (
          <InfoRow label="Duration">{formatDuration(photo.duration_ms)}</InfoRow>
        )}

        {photo.codec && (
          <InfoRow label="Codec">{photo.codec}</InfoRow>
        )}

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">Tags</span>
          <PhotoTagBar photoPath={photo.path} />
        </div>

        {/* TODO(phase-A): wire album memberships from modal — needs albumsByPhoto memo passed as prop */}
      </div>
    </div>
  );
}

// ─── Action bar ──────────────────────────────────────────────────────────────

function ActionButton({ onClick, icon: Icon, label, active, danger }) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={`flex items-center justify-center p-2.5 rounded-xl border transition-all
          ${danger
            ? 'border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50'
            : active
              ? 'border-emerald-400/50 text-emerald-400 bg-emerald-500/10'
              : 'border-white/10 text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20'
          }`}
      >
        <Icon size={18} />
      </button>
    </Tooltip>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

const PhotoModal = ({
  photo,
  photos = [],
  onClose,
  onSelectPhoto,
  onToggleFavorite,
  onArchive,
  onDelete,
  onAddToAlbum,
  onTagAssign,
  onReveal,
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, tx: 0, ty: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const modalRef = useRef(null);

  useFocusTrap(modalRef, !!photo);

  const currentIndex = photos.findIndex(p => p.path === photo?.path);

  // Reset zoom whenever photo changes
  useEffect(() => {
    setZoom({ scale: 1, tx: 0, ty: 0 });
  }, [photo?.path]);

  const goTo = useCallback((index) => {
    const clamped = (index + photos.length) % photos.length;
    onSelectPhoto?.(photos[clamped]);
  }, [photos, onSelectPhoto]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!photo) return;

    const handleKey = (e) => {
      // Don't fire when focus is inside an input/select/textarea
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      const isMeta = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); goTo(currentIndex - 1); return; }
      if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); goTo(currentIndex + 1); return; }
      if (e.key === 'f') { onToggleFavorite?.(photo); return; }
      if (e.key === 'i') { setShowInfo(v => !v); return; }
      if (e.key === 'o') { onReveal?.(photo); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !isMeta) { onArchive?.(photo); return; }
      if (e.key === 'Backspace' && isMeta) { onDelete?.(photo); return; }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [photo, currentIndex, goTo, onClose, onToggleFavorite, onArchive, onDelete, onReveal]);

  // Wheel: zoom around cursor (only when not holding Cmd/Ctrl)
  const handleWheel = useCallback((e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();

    const isVideo = photo?.mediaType === 'video';
    if (isVideo) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;

    setZoom(prev => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.5, Math.min(10, prev.scale * factor));
      // Zoom toward cursor: adjust translation so cursor point stays fixed
      const newTx = cursorX - (cursorX - prev.tx) * (newScale / prev.scale);
      const newTy = cursorY - (cursorY - prev.ty) * (newScale / prev.scale);
      return { scale: newScale, tx: newTx, ty: newTy };
    });
  }, [photo?.mediaType]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Double-click: toggle fit ↔ 100%
  const handleDoubleClick = useCallback((e) => {
    const isVideo = photo?.mediaType === 'video';
    if (isVideo) return;
    setZoom(prev => {
      if (Math.abs(prev.scale - 1) < 0.05) {
        // Go to 100%: center on cursor
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { scale: 1, tx: 0, ty: 0 };
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        return { scale: 2, tx: cursorX * (1 - 2), ty: cursorY * (1 - 2) };
      }
      return { scale: 1, tx: 0, ty: 0 };
    });
  }, [photo?.mediaType]);

  // Drag to pan when zoomed
  const handleMouseDown = useCallback((e) => {
    if (zoom.scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - zoom.tx, y: e.clientY - zoom.ty };
  }, [zoom]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !dragStart.current) return;
    setZoom(prev => ({
      ...prev,
      tx: e.clientX - dragStart.current.x,
      ty: e.clientY - dragStart.current.y,
    }));
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStart.current = null;
  }, []);

  if (!photo) return null;

  const isVideo = photo.mediaType === 'video';
  const imgStyle = {
    transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
    transformOrigin: 'center center',
    cursor: zoom.scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
    transition: isDragging ? 'none' : 'transform 0.1s ease-out',
  };

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < photos.length - 1 && currentIndex !== -1;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo: ${photo.name}`}
      className="fixed inset-0 z-50 flex bg-black/95 backdrop-blur-md animate-in fade-in duration-200"
    >
      {/* Close button */}
      <div className="absolute top-5 right-5 z-50">
        <Tooltip label="Close (Esc)" position="bottom">
          <button
            onClick={onClose}
            aria-label="Close (Esc)"
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10"
          >
            <X size={22} />
          </button>
        </Tooltip>
      </div>

      {/* Prev / Next navigation */}
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 z-30 group">
        <Tooltip label="Previous (←)" position="right">
          <button
            onClick={() => goTo(currentIndex - 1)}
            aria-label="Previous photo"
            disabled={!canGoPrev}
            className={`p-2 rounded-full bg-black/40 border border-white/10 text-white transition-all
              opacity-0 group-hover:opacity-100
              ${!canGoPrev ? 'opacity-0 cursor-default' : 'hover:bg-white/20'}`}
          >
            <ChevronLeft size={28} />
          </button>
        </Tooltip>
      </div>

      <div className="absolute inset-y-0 right-0 flex items-center pr-3 z-30 group" style={{ right: showInfo ? '320px' : '0' }}>
        <Tooltip label="Next (→)" position="left">
          <button
            onClick={() => goTo(currentIndex + 1)}
            aria-label="Next photo"
            disabled={!canGoNext}
            className={`p-2 rounded-full bg-black/40 border border-white/10 text-white transition-all
              opacity-0 group-hover:opacity-100
              ${!canGoNext ? 'opacity-0 cursor-default' : 'hover:bg-white/20'}`}
          >
            <ChevronRight size={28} />
          </button>
        </Tooltip>
      </div>

      {/* Image / video area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden select-none relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {isVideo ? (
          <VideoPlayer src={photo.url} />
        ) : (
          <img
            ref={imgRef}
            src={photo.url}
            alt={photo.name}
            draggable={false}
            style={imgStyle}
            className="max-h-full max-w-full shadow-2xl rounded-lg object-contain"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
            }}
          />
        )}
      </div>

      {/* Info drawer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="pointer-events-auto">
          <PhotoModalInfoDrawer photo={photo} isOpen={showInfo} />
        </div>
      </div>

      {/* Action bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl">
        <span className="text-white/40 font-mono text-xs mr-2 max-w-xs truncate">
          {photo.name}
          {isVideo && (
            <span className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">
              VIDEO
            </span>
          )}
        </span>

        <ActionButton
          icon={Heart}
          label="Favorite (F)"
          active={photo.is_favorite}
          onClick={() => onToggleFavorite?.(photo)}
        />
        <ActionButton
          icon={Info}
          label="Info (I)"
          active={showInfo}
          onClick={() => setShowInfo(v => !v)}
        />
        <ActionButton
          icon={FolderPlus}
          label="Add to Album"
          onClick={() => onAddToAlbum?.(photo)}
        />
        <ActionButton
          icon={Tag}
          label="Tag"
          onClick={() => onTagAssign?.(photo)}
        />
        <ActionButton
          icon={Archive}
          label="Archive (Delete)"
          onClick={() => onArchive?.(photo)}
        />
        <ActionButton
          icon={Trash2}
          label="Delete Permanently (⌘⌫)"
          danger
          onClick={() => onDelete?.(photo)}
        />
        <ActionButton
          icon={FolderOpen}
          label="Reveal in Finder (O)"
          onClick={() => onReveal?.(photo)}
        />
      </div>
    </div>
  );
};

export default PhotoModal;
