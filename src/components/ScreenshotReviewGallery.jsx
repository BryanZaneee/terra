import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, MonitorSmartphone, CheckCircle, RotateCcw, Archive } from 'lucide-react';

const ScreenshotReviewGallery = ({ isOpen, onClose, screenshots, onArchive, onRefresh }) => {
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

  const selectAll = () => {
    setSelectedForArchive(new Set(screenshots.map(s => s.path)));
  };

  const selectNone = () => {
    setSelectedForArchive(new Set());
  };

  const handleArchive = () => {
    if (selectedForArchive.size > 0) {
      setShowConfirm(true);
    }
  };

  const confirmArchive = () => {
    onArchive(Array.from(selectedForArchive));
    setSelectedForArchive(new Set());
    setShowConfirm(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md animate-in fade-in duration-200 overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <MonitorSmartphone size={24} className="text-blue-400" />
              Screenshots
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {screenshots.length} screenshots detected
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 text-xs text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Select All
            </button>
            <button
              onClick={selectNone}
              className="px-3 py-1.5 text-xs text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Select None
            </button>
            {selectedForArchive.size > 0 && (
              <button
                onClick={handleArchive}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-500/30"
              >
                <Archive size={16} />
                Archive {selectedForArchive.size}
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
          {screenshots.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <CheckCircle size={64} className="mb-4 text-emerald-400" />
              <p className="text-xl font-medium text-white">No screenshots found!</p>
              <p className="text-sm mt-2">Your library doesn't contain any detected screenshots.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {screenshots.map((photo) => (
                <div
                  key={photo.path}
                  onClick={() => togglePhotoSelection(photo.path)}
                  className={`relative aspect-[9/16] rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
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
                  <div className="absolute top-2 right-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedForArchive.has(photo.path)
                        ? 'bg-red-500 border-red-500'
                        : 'border-white/40 bg-black/40'
                    }`}>
                      {selectedForArchive.has(photo.path) && (
                        <CheckCircle size={12} className="text-white" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80">
          <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-2">Archive Screenshots?</h3>
            <p className="text-white/60 text-sm mb-4">
              {selectedForArchive.size} screenshots will be moved to archive and permanently deleted after 14 days.
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

export default ScreenshotReviewGallery;
