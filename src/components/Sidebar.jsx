import { invoke } from '@tauri-apps/api/core';
import {
  Grid, Calendar, Heart, Plus, Upload, Folder, Copy,
  MonitorSmartphone, Archive, Eye, BarChart3, Settings,
  Image as ImageIcon, Cloud, HardDrive, Sun, Moon
} from 'lucide-react';
import SmartCollections from './SmartCollections';
import CloudProviderButton from './CloudProviderButton';
import { useTheme } from '../contexts/ThemeContext';

const Sidebar = ({
  photos,
  viewMode,
  setViewMode,
  searchQuery,
  handleSearch,
  searchInputRef,
  albums,
  tags,
  selectedTagIds,
  setSelectedTagIds,
  smartCollections,
  loadSmartCollections,
  unreviewedCount,
  loading,
  uploadStatus,
  error,
  onUpload,
  onCreateAlbum,
  onCreateTag,
  onSettings,
  onScanDuplicates,
  onScanScreenshots,
  onOpenArchive,
  onOpenTerraForm,
  onOpenStorageAnalytics,
}) => {
  const { isLight, toggleTheme } = useTheme();
  return (
    <div className="fixed left-4 top-4 bottom-4 w-64 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl shadow-2xl flex flex-col z-20 overflow-hidden">
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-emerald-200 to-white/50 bg-clip-text text-transparent">TERRA</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
              title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {isLight ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              onClick={onSettings}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
        <div className="text-xs text-white/40 font-mono mt-1 tracking-widest">LOCAL LIBRARY</div>
        {photos.length > 0 && (
          <div className="mt-2 text-xs text-emerald-400/60 font-mono">{photos.length} photos</div>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <button
          onClick={onUpload}
          disabled={loading}
          className="w-full flex items-center justify-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 hover:border-emerald-400/50 disabled:opacity-50 shadow-lg shadow-emerald-500/10"
        >
          <Upload size={20} />
          <span>Upload Photos</span>
        </button>

        <div className="relative mt-4 mb-2">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search photos... (/)"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 pl-9"
          />
          <div className="absolute left-3 top-2.5 text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
        </div>

        {uploadStatus && (
          <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/20">
            <div className="text-xs text-emerald-400 font-mono text-center">{uploadStatus}</div>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/20">
            <div className="text-xs text-red-400 font-mono text-center">{error}</div>
          </div>
        )}

        <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">View By</div>
        <button onClick={() => setViewMode('all')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'all' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <Grid size={18} /> <span>All Photos</span>
        </button>
        <button onClick={() => setViewMode('year')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'year' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <Calendar size={18} /> <span>Years</span>
        </button>
        <button onClick={() => setViewMode('month')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'month' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <Calendar size={18} /> <span>Months</span>
        </button>
        <button onClick={() => setViewMode('locations')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'locations' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> <span>Locations</span>
        </button>
        <button onClick={() => setViewMode('favorites')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'favorites' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <Heart size={18} /> <span>Favorites</span>
        </button>

        <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2 flex justify-between items-center">
          <span>Albums</span>
          <button onClick={onCreateAlbum} className="hover:text-white transition-colors"><Plus size={14} /></button>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {albums.map(album => (
            <button
              key={album.id}
              onClick={() => setViewMode(`album:${album.id}`)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${viewMode === `album:${album.id}` ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'} group`}
            >
              <div className="flex items-center space-x-3 truncate">
                <Folder size={16} />
                <span className="truncate">{album.name}</span>
              </div>
              <span className="text-[10px] opacity-50">{album.count}</span>
            </button>
          ))}
          {albums.length === 0 && (
            <div className="px-3 py-2 text-xs text-white/30 italic">No albums yet</div>
          )}
        </div>

        <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2 flex justify-between items-center">
          <span>Tags</span>
          <button onClick={onCreateTag} className="hover:text-white transition-colors"><Plus size={14} /></button>
        </div>
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {tags.map(tag => (
            <button
              key={tag.id}
              onClick={() => {
                const isActive = selectedTagIds.includes(tag.id);
                const newIds = isActive
                  ? selectedTagIds.filter(id => id !== tag.id)
                  : [...selectedTagIds, tag.id];
                setSelectedTagIds(newIds);
                if (newIds.length > 0) {
                  setViewMode('tags');
                } else {
                  setViewMode('all');
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-all ${
                selectedTagIds.includes(tag.id) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
              } group`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </div>
              <span className="text-[10px] opacity-50">{tag.count}</span>
            </button>
          ))}
          {tags.length === 0 && (
            <div className="px-3 py-2 text-xs text-white/30 italic">No tags yet</div>
          )}
        </div>

        <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Filter</div>
        <button onClick={() => setViewMode('photos')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'photos' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <ImageIcon size={18} /> <span>Photos Only</span>
        </button>
        <button onClick={() => setViewMode('videos')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'videos' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></svg> <span>Videos Only</span>
        </button>

        {smartCollections.length > 0 && (
          <>
            <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Collections</div>
            <SmartCollections
              collections={smartCollections}
              activeCollectionId={viewMode}
              onSelect={(id) => setViewMode(`collection:${id}`)}
              onScanFileSizes={async () => {
                try {
                  await invoke('populate_file_sizes');
                  loadSmartCollections();
                } catch (err) {
                  console.error('Failed to scan file sizes:', err);
                }
              }}
            />
          </>
        )}

        <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Clean Up</div>
        <button onClick={onScanDuplicates} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
          <Copy size={18} /> <span>Find Duplicates</span>
        </button>
        <button onClick={onScanScreenshots} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
          <MonitorSmartphone size={18} /> <span>Find Screenshots</span>
        </button>
        <button onClick={onOpenArchive} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
          <Archive size={18} /> <span>View Archive</span>
        </button>
        <button onClick={onOpenTerraForm} className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
          <div className="flex items-center space-x-3">
            <Eye size={18} />
            <span>TerraForm Review</span>
          </div>
          {unreviewedCount > 0 && (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">{unreviewedCount}</span>
          )}
        </button>
        <button onClick={onOpenStorageAnalytics} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
          <BarChart3 size={18} /> <span>Storage Analytics</span>
        </button>

        <div className="mt-8 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Cloud Import</div>
        <div className="space-y-1">
          <CloudProviderButton icon={Cloud} name="iCloud Photos" />
          <CloudProviderButton icon={ImageIcon} name="Google Photos" />
          <CloudProviderButton icon={HardDrive} name="Dropbox / Drive" />
        </div>
      </nav>
    </div>
  );
};

export default Sidebar;
