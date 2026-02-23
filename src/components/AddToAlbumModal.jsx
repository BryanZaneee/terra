import { convertFileSrc } from '@tauri-apps/api/core';
import { Folder, Plus } from 'lucide-react';

const AddToAlbumModal = ({ isOpen, onClose, albums, onSelect }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4">Add to Album</h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {albums.map(album => (
            <button
              key={album.id}
              onClick={() => onSelect(album.id)}
              className="w-full flex items-center space-x-3 p-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
            >
              <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center overflow-hidden">
                {album.cover_photo_path ? (
                  <img src={convertFileSrc(album.cover_photo_path)} className="w-full h-full object-cover" />
                ) : (
                  <Folder size={20} className="text-white/40" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-white font-medium">{album.name}</div>
                <div className="text-xs text-white/40">{album.count} items</div>
              </div>
              <Plus size={16} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default AddToAlbumModal;
