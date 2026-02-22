import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Plus, Search, Tag, Trash2, Edit3, Check } from 'lucide-react';

const TAG_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

// --- Tag Create/Edit Modal ---
export const TagCreateModal = ({ isOpen, onClose, onSave, editTag = null }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[4].value);

  useEffect(() => {
    if (editTag) {
      setName(editTag.name);
      setColor(editTag.color);
    } else {
      setName('');
      setColor(TAG_COLORS[4].value);
    }
  }, [editTag, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      if (editTag) {
        await invoke('update_tag', { id: editTag.id, name: name.trim(), color });
      } else {
        await invoke('create_tag', { name: name.trim(), color });
      }
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to save tag:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4">
          {editTag ? 'Edit Tag' : 'Create New Tag'}
        </h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tag Name"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 mb-4"
            autoFocus
          />

          <div className="mb-6">
            <label className="block text-sm text-white/50 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {TAG_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === c.value
                      ? 'border-white scale-110'
                      : 'border-transparent hover:border-white/30'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editTag ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Tag Assign Popover (for bulk tagging) ---
export const TagAssignPopover = ({ isOpen, onClose, photoPaths, onTagsChanged }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [filteredTags, setFilteredTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState(new Set());
  const searchRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      loadTags();
      setSelectedTagIds(new Set());
      setSearchQuery('');
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTags(allTags);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredTags(allTags.filter(t => t.name.toLowerCase().includes(q)));
    }
  }, [searchQuery, allTags]);

  const loadTags = async () => {
    try {
      const tags = await invoke('get_all_tags');
      setAllTags(tags);
      setFilteredTags(tags);
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  };

  if (!isOpen) return null;

  const toggleTag = (tagId) => {
    const newSet = new Set(selectedTagIds);
    if (newSet.has(tagId)) {
      newSet.delete(tagId);
    } else {
      newSet.add(tagId);
    }
    setSelectedTagIds(newSet);
  };

  const handleApply = async () => {
    if (selectedTagIds.size === 0) return;
    try {
      await invoke('add_tags_to_photos', {
        tagIds: Array.from(selectedTagIds),
        photoPaths
      });
      if (onTagsChanged) onTagsChanged();
      onClose();
    } catch (err) {
      console.error('Failed to apply tags:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Tag size={20} className="text-emerald-400" />
            Tag {photoPaths.length} photo{photoPaths.length !== 1 ? 's' : ''}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-2.5 text-white/40" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pl-9 text-sm text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        {/* Tag List */}
        <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
          {filteredTags.length === 0 ? (
            <div className="text-center text-white/30 text-sm py-4">No tags found</div>
          ) : (
            filteredTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedTagIds.has(tag.id)
                    ? 'bg-emerald-500/20 text-white'
                    : 'text-white/70 hover:bg-white/5'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="flex-1 text-left">{tag.name}</span>
                <span className="text-[10px] text-white/40">{tag.count}</span>
                {selectedTagIds.has(tag.id) && (
                  <Check size={14} className="text-emerald-400" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={selectedTagIds.size === 0}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply Tags
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Photo Modal Tag Bar (inline tag display and management) ---
export const PhotoTagBar = ({ photoPath }) => {
  const [tags, setTags] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (photoPath) loadTags();
  }, [photoPath]);

  const loadTags = async () => {
    try {
      const result = await invoke('get_tags_for_photo', { path: photoPath });
      setTags(result);
    } catch (err) {
      console.error('Failed to load tags for photo:', err);
    }
  };

  const handleRemoveTag = async (tagId) => {
    try {
      await invoke('remove_tag_from_photo', { tagId, photoPath });
      setTags(prev => prev.filter(t => t.id !== tagId));
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await invoke('search_tags', { query });
      // Exclude already-assigned tags
      const existingIds = new Set(tags.map(t => t.id));
      setSearchResults(results.filter(t => !existingIds.has(t.id)));
    } catch (err) {
      console.error('Failed to search tags:', err);
    }
  };

  const handleAddTag = async (tagId) => {
    try {
      await invoke('add_tags_to_photos', { tagIds: [tagId], photoPaths: [photoPath] });
      await loadTags();
      setSearchQuery('');
      setSearchResults([]);
      setShowSearch(false);
    } catch (err) {
      console.error('Failed to add tag:', err);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap mt-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white/90 border border-white/10"
          style={{ backgroundColor: tag.color + '30', borderColor: tag.color + '50' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
          <button
            onClick={(e) => { e.stopPropagation(); handleRemoveTag(tag.id); }}
            className="ml-0.5 hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {showSearch ? (
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search tags..."
            className="bg-white/5 border border-white/10 rounded-full px-3 py-0.5 text-xs text-white w-32 focus:outline-none focus:border-emerald-500/50"
            autoFocus
            onBlur={() => setTimeout(() => { setShowSearch(false); setSearchResults([]); }, 200)}
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-10 min-w-[160px]">
              {searchResults.map((tag) => (
                <button
                  key={tag.id}
                  onMouseDown={(e) => { e.preventDefault(); handleAddTag(tag.id); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowSearch(true); }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-white/40 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors"
        >
          <Plus size={10} />
          Tag
        </button>
      )}
    </div>
  );
};

export default { TagCreateModal, TagAssignPopover, PhotoTagBar };
