import { X, Heart } from 'lucide-react';
import { PhotoTagBar } from './TagManager';
import VideoPlayer from './VideoPlayer';

const PhotoModal = ({ photo, onClose, onToggleFavorite }) => {
  if (!photo) return null;

  const isVideo = photo.mediaType === 'video';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full h-full flex flex-col items-center justify-center p-4 md:p-8">
        <button onClick={onClose} className="absolute top-6 right-6 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10">
          <X size={24} />
        </button>

        <div className="w-full h-full max-w-6xl max-h-[85vh] flex items-center justify-center">
          {isVideo ? (
            <VideoPlayer src={photo.url} />
          ) : (
            <img
              src={photo.url}
              alt={photo.name}
              className="max-h-full max-w-full shadow-2xl border border-white/10 rounded-lg object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
              }}
            />
          )}
        </div>

        <div className="mt-4 flex flex-col items-center text-white/70 font-mono text-sm">
          <div className="flex items-center space-x-4 mb-2">
            <span className="text-white font-bold tracking-wider flex items-center gap-2">
              {photo.name}
              {isVideo && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">VIDEO</span>}
            </span>
            <button
              onClick={() => onToggleFavorite(photo)}
              className={`p-2 rounded-full transition-all ${photo.is_favorite ? 'text-red-500 bg-red-500/10' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <Heart size={20} fill={photo.is_favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <span>{new Date(photo.date * 1000).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          <PhotoTagBar photoPath={photo.path} />
        </div>
      </div>
    </div>
  );
};

export default PhotoModal;
