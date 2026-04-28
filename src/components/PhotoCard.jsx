import { useContext } from 'react';
import { CheckCircle, Heart, Play } from 'lucide-react';
import { AppContext } from '../contexts/AppContext';
import { getThumbnailUrl } from '../utils/photoHelpers';

const PhotoCard = ({ photo, isSelected, selectionMode, onPhotoClick, onToggleSelection }) => {
  // Tolerate missing provider so isolated component tests don't need to wrap in AppProvider.
  const ctx = useContext(AppContext);
  const cardSrc = getThumbnailUrl(photo, ctx?.thumbCacheRoot ?? null);

  return (
    <div
      onClick={(e) => onPhotoClick(photo, e)}
      className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-white/5 border transition-all duration-300 hover:shadow-[0_0_30px_rgba(52,211,153,0.1)] ${isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/50' : 'border-white/5 hover:border-white/30'}`}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelection(photo.path);
        }}
        className={`absolute top-2 left-2 z-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 transition-all cursor-pointer hover:bg-black/70 ${isSelected
          ? 'opacity-100 text-emerald-400'
          : selectionMode
            ? 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white'
            : 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white translate-y-[-10px] group-hover:translate-y-0'
          }`}
      >
        <CheckCircle size={20} fill={isSelected ? "currentColor" : "none"} />
      </div>

      <img
        src={cardSrc}
        alt={photo.name}
        loading="lazy"
        decoding="async"
        width="256"
        height="256"
        draggable={false}
        className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100 ${isSelected ? 'scale-95' : ''}`}
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
        }}
      />

      {!selectionMode && photo.is_favorite && (
        <div className={`absolute top-2 z-10 text-red-500 drop-shadow-lg ${photo.mediaType === 'video' ? 'right-10' : 'right-2'}`}>
          <Heart size={16} fill="currentColor" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
        <p className="text-xs font-mono text-white truncate">{photo.name}</p>
        <p className="text-[10px] font-mono text-white/60">{new Date(photo.date * 1000).toLocaleDateString()}</p>
      </div>
      {photo.mediaType === 'video' && (
        <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm rounded-full p-1.5 border border-white/10">
          <Play size={12} className="text-white fill-white" />
        </div>
      )}
    </div>
  );
};

export default PhotoCard;
