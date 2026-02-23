import { Folder, Tag, Trash2, X, CheckCircle } from 'lucide-react';

const SelectionToolbar = ({
  selectionMode,
  selectedPhotos,
  onAddToAlbum,
  onTagAssign,
  onDelete,
  onCancel,
  onEnterSelectionMode,
}) => {
  if (selectionMode) {
    return (
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-[#1a1a1a]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl px-6 py-3 flex items-center space-x-6 z-40 animate-in slide-in-from-bottom-10">
        <div className="text-sm font-mono text-white/60 border-r border-white/10 pr-6">
          <span className="text-white font-bold">{selectedPhotos.size}</span> selected
        </div>

        <button onClick={onAddToAlbum} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-white transition-colors disabled:opacity-30">
          <Folder size={20} />
          <span className="text-[10px] uppercase tracking-wider">Add to Album</span>
        </button>

        <button onClick={onTagAssign} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-emerald-400 transition-colors disabled:opacity-30">
          <Tag size={20} />
          <span className="text-[10px] uppercase tracking-wider">Tag</span>
        </button>

        <button onClick={onDelete} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-red-400 transition-colors disabled:opacity-30">
          <Trash2 size={20} />
          <span className="text-[10px] uppercase tracking-wider">Delete</span>
        </button>

        <div className="w-px h-8 bg-white/10"></div>

        <button onClick={onCancel} className="flex flex-col items-center space-y-1 text-white/60 hover:text-white transition-colors">
          <X size={20} />
          <span className="text-[10px] uppercase tracking-wider">Cancel</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onEnterSelectionMode}
      className="fixed bottom-8 right-8 bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-full shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 z-30"
      title="Select Photos"
    >
      <CheckCircle size={24} />
    </button>
  );
};

export default SelectionToolbar;
