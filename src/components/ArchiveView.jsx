import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, RotateCcw, Archive } from 'lucide-react';

const ArchiveView = ({ isOpen, onClose, archivedPhotos, onRestore, onRefresh }) => {
  const [selectedForRestore, setSelectedForRestore] = useState(new Set());

  if (!isOpen) return null;

  const togglePhotoSelection = (path) => {
    const newSet = new Set(selectedForRestore);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    setSelectedForRestore(newSet);
  };

  const handleRestore = () => {
    onRestore(Array.from(selectedForRestore));
    setSelectedForRestore(new Set());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md animate-in fade-in duration-200 overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <Archive size={24} className="text-orange-400" />
              Archive
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {archivedPhotos.length} photos in archive • Auto-deleted after 14 days
            </p>
          </div>
          <div className="flex items-center gap-3">
            {selectedForRestore.size > 0 && (
              <button
                onClick={handleRestore}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium transition-colors border border-emerald-500/30"
              >
                <RotateCcw size={16} />
                Restore {selectedForRestore.size}
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
          {archivedPhotos.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <Archive size={64} className="mb-4 text-white/20" />
              <p className="text-xl font-medium text-white">Archive is empty</p>
              <p className="text-sm mt-2">Archived photos will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {archivedPhotos.map((item) => (
                <div
                  key={item.photo.path}
                  onClick={() => togglePhotoSelection(item.photo.path)}
                  className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                    selectedForRestore.has(item.photo.path)
                      ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                      : 'border-transparent hover:border-white/30'
                  }`}
                >
                  <img
                    src={convertFileSrc(item.photo.path)}
                    alt={item.photo.name}
                    className="w-full h-full object-cover opacity-60"
                  />
                  {selectedForRestore.has(item.photo.path) && (
                    <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                      <RotateCcw size={32} className="text-emerald-400" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      item.days_until_deletion <= 3
                        ? 'bg-red-500/80 text-white'
                        : 'bg-orange-500/80 text-white'
                    }`}>
                      {item.days_until_deletion}d left
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2">
                    <p className="text-xs text-white truncate">{item.photo.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArchiveView;
