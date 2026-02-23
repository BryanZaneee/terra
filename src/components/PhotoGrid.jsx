import { Camera, ChevronDown, ChevronRight } from 'lucide-react';
import PhotoCard from './PhotoCard';

const PhotoGrid = ({
  loading,
  photos,
  groupedPhotos,
  expandedGroups,
  toggleGroup,
  selectedPhotos,
  selectionMode,
  onPhotoClick,
  onToggleSelection,
  uploadStatus,
}) => {
  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"></div>
        <div className="font-mono text-sm text-white/50 animate-pulse">{uploadStatus || 'Processing...'}</div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Camera size={48} className="text-white/20" />
        <div className="font-mono text-sm text-white/50 text-center">
          No photos in library yet.<br />
          Click "Upload Photos" to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {groupedPhotos.map(([groupKey, groupItems]) => (
        <div key={groupKey} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center space-x-2 mb-4 cursor-pointer select-none group" onClick={() => toggleGroup(groupKey)}>
            <div className="p-1 rounded bg-white/5 group-hover:bg-white/10 transition-colors">
              {expandedGroups[groupKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            <h2 className="text-xl font-light tracking-wide text-white/90">{groupKey}</h2>
            <div className="h-px flex-grow bg-gradient-to-r from-white/20 to-transparent ml-4"></div>
            <span className="text-xs font-mono text-white/40">{groupItems.length} items</span>
          </div>

          {expandedGroups[groupKey] && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {groupItems.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  isSelected={selectedPhotos.has(photo.path)}
                  selectionMode={selectionMode}
                  onPhotoClick={onPhotoClick}
                  onToggleSelection={onToggleSelection}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default PhotoGrid;
