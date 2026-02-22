import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { X, Settings, FolderOpen, AlertTriangle } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, libraryPath, onLibraryPathChange }) => {
  const [currentPath, setCurrentPath] = useState(libraryPath || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrentPath(libraryPath || '');
  }, [libraryPath]);

  if (!isOpen) return null;

  const handleChangePath = async () => {
    try {
      const selected = await open({ directory: true });
      if (!selected) return;

      setSaving(true);
      await invoke('set_library_path', { path: selected });
      setCurrentPath(selected);
      if (onLibraryPathChange) onLibraryPathChange(selected);
    } catch (err) {
      console.error('Failed to set library path:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-emerald-400" />
            Settings
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Library Path */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Library Storage Path</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono truncate">
                {currentPath || 'Loading...'}
              </div>
              <button
                onClick={handleChangePath}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white/80 hover:text-white transition-colors disabled:opacity-50"
              >
                <FolderOpen size={16} />
                Change
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs text-white/40">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-yellow-500/60" />
              <span>New uploads will go to the new path. Existing photos stay in their current location.</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
