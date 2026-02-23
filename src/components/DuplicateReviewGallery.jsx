import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, Copy, ChevronDown, CheckCircle, RotateCcw, Archive } from 'lucide-react';

const DuplicateReviewGallery = ({ isOpen, onClose, duplicateGroups, onArchive, onRefresh }) => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedForArchive, setSelectedForArchive] = useState(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  if (!isOpen) return null;

  const togglePhotoSelection = (path) => {
    const newSet = new Set(selectedForArchive);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    setSelectedForArchive(newSet);
  };

  const handleArchive = () => {
    if (selectedForArchive.size > 0) {
      setShowConfirm(true);
    }
  };

  const confirmArchive = () => {
    onArchive(Array.from(selectedForArchive));
    setSelectedForArchive(new Set());
    setSelectedGroup(null);
    setShowConfirm(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md animate-in fade-in duration-200 overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <Copy size={24} className="text-emerald-400" />
              Duplicate Photos
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {duplicateGroups.length} duplicate groups found
            </p>
          </div>
          <div className="flex items-center gap-3">
            {selectedForArchive.size > 0 && (
              <button
                onClick={handleArchive}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-500/30"
              >
                <Archive size={16} />
                Archive {selectedForArchive.size} photos
              </button>
            )}
            <button
              onClick={onRefresh}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Refresh"
            >
              <RotateCcw size={20} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {duplicateGroups.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <CheckCircle size={64} className="mb-4 text-emerald-400" />
              <p className="text-xl font-medium text-white">No duplicates found!</p>
              <p className="text-sm mt-2">Your photo library is clean.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {duplicateGroups.map((group) => (
                <div
                  key={group.group_id}
                  className={`bg-white/5 border rounded-xl p-4 transition-all ${
                    selectedGroup === group.group_id
                      ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setSelectedGroup(selectedGroup === group.group_id ? null : group.group_id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${
                        group.group_type === 'exact'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                      }`}>
                        {group.group_type === 'exact' ? 'Exact Match' : 'Similar'}
                      </div>
                      <span className="text-white/60 text-sm">
                        {group.photos.length} photos
                      </span>
                      {group.group_type === 'similar' && (
                        <span className="text-white/40 text-xs">
                          {Math.round(group.similarity_score * 100)}% similar
                        </span>
                      )}
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-white/40 transition-transform ${
                        selectedGroup === group.group_id ? 'rotate-180' : ''
                      }`}
                    />
                  </div>

                  <div className="flex gap-2 mt-3">
                    {group.photos.slice(0, 4).map((photo, idx) => (
                      <div key={photo.path} className="relative w-16 h-16 rounded overflow-hidden bg-white/5">
                        <img
                          src={convertFileSrc(photo.path)}
                          alt={photo.name}
                          className="w-full h-full object-cover"
                        />
                        {idx === 3 && group.photos.length > 4 && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-sm font-medium">
                            +{group.photos.length - 4}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {selectedGroup === group.group_id && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-xs text-white/40 mb-3">
                        Click photos to select for archiving. Keep at least one!
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {group.photos.map((photo) => (
                          <div
                            key={photo.path}
                            onClick={() => togglePhotoSelection(photo.path)}
                            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                              selectedForArchive.has(photo.path)
                                ? 'border-red-500 ring-2 ring-red-500/30'
                                : 'border-transparent hover:border-white/30'
                            }`}
                          >
                            <img
                              src={convertFileSrc(photo.path)}
                              alt={photo.name}
                              className="w-full h-full object-cover"
                            />
                            {selectedForArchive.has(photo.path) && (
                              <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                                <Archive size={32} className="text-red-400" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2">
                              <p className="text-xs text-white truncate">{photo.name}</p>
                              <p className="text-[10px] text-white/60">
                                {photo.width}x{photo.height} • {new Date(photo.date_taken * 1000).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80">
          <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-2">Archive Photos?</h3>
            <p className="text-white/60 text-sm mb-4">
              {selectedForArchive.size} photos will be moved to archive and permanently deleted after 14 days.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicateReviewGallery;
