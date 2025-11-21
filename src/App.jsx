import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Camera, Calendar, Grid, Image as ImageIcon, X,
  ChevronDown, ChevronRight, Cloud, Download, HardDrive, Upload, Play,
  Heart, Plus, Trash2, Folder, CheckCircle, MoreHorizontal, LogOut
} from 'lucide-react';

// --- COMPONENTS ---

const DitherBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    const chars = " .:-=+*#%@";

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    // Create 6-10 bubbles with varying sizes (small to large)
    const bubbles = [];
    const bubbleCount = Math.floor(Math.random() * 5) + 6; // 6-10 bubbles

    for (let i = 0; i < bubbleCount; i++) {
      bubbles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 60 + 20, // 20-80px radius (small to large)
        speed: 0.004 // 2x faster than original (was 0.002)
      });
    }

    const render = () => {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#2a2a2a';
      ctx.font = '12px monospace';

      const cols = Math.floor(canvas.width / 12);
      const rows = Math.floor(canvas.height / 14);

      // Move bubbles upward and wrap around
      bubbles.forEach(bubble => {
        bubble.y -= bubble.speed * 100; // Move upward
        if (bubble.y + bubble.radius < 0) {
          // Wrap to bottom when bubble exits top
          bubble.y = canvas.height + bubble.radius;
          bubble.x = Math.random() * canvas.width; // New random x position
        }
      });

      // Render bubbles using distance-based ASCII characters
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const pixelX = x * 12;
          const pixelY = y * 14;

          // Check distance to each bubble
          let closestDist = Infinity;
          let closestRadius = 0;

          bubbles.forEach(bubble => {
            const dx = pixelX - bubble.x;
            const dy = pixelY - bubble.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const normalizedDist = dist / bubble.radius;

            if (normalizedDist < closestDist) {
              closestDist = normalizedDist;
              closestRadius = bubble.radius;
            }
          });

          // Render bubble outline with ASCII characters
          if (closestDist < 1.0) {
            // Inside bubble - use gradient based on distance from edge
            const intensity = 1.0 - closestDist;
            const charIndex = Math.floor(intensity * (chars.length - 1));
            ctx.fillText(chars[charIndex], pixelX, pixelY);
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-full -z-10 pointer-events-none" />;
};

const CreateAlbumModal = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name);
      setName('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-4">Create New Album</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Album Name"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 mb-6"
            autoFocus
          />
          <div className="flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={!name.trim()} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Create Album</button>
          </div>
        </form>
      </div>
    </div>
  );
};

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

const PhotoModal = ({ photo, onClose, onToggleFavorite }) => {
  if (!photo) return null;

  const isVideo = photo.mediaType === 'video';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full h-full flex flex-col items-center justify-center p-4 md:p-8">
        <button onClick={onClose} className="absolute top-6 right-6 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10">
          <X size={24} />
        </button>

        <div className="w-full h-full max-w-6xl max-h-[85vh] flex items-center justify-center">
          {isVideo ? (
            <VideoPlayer src={photo.url} />
          ) : (
            <img src={photo.url} alt={photo.name} className="max-h-full max-w-full shadow-2xl border border-white/10 rounded-lg object-contain" />
          )}
        </div>

        <div className="mt-4 flex flex-col items-center text-white/70 font-mono text-sm">
          <div className="flex items-center space-x-4 mb-2">
            <span className="text-white font-bold tracking-wider flex items-center gap-2">
              {photo.name}
              {isVideo && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">VIDEO</span>}
            </span>
            <button
              onClick={() => onToggleFavorite(photo)}
              className={`p-2 rounded-full transition-all ${photo.is_favorite ? 'text-red-500 bg-red-500/10' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
            >
              <Heart size={20} fill={photo.is_favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <span>{new Date(photo.date * 1000).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
};

const VideoPlayer = ({ src, poster, autoPlay = true }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [duration, setDuration] = useState(0);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateProgress = () => {
      setProgress((video.currentTime / video.duration) * 100);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    if (autoPlay) {
      video.play().catch(e => console.log("Autoplay prevented:", e));
    }

    return () => {
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [src, autoPlay]);

  const togglePlay = () => {
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleSeek = (e) => {
    const seekTime = (e.target.value / 100) * videoRef.current.duration;
    videoRef.current.currentTime = seekTime;
    setProgress(e.target.value);
  };

  const toggleCaptions = () => {
    const video = videoRef.current;
    if (!video) return;

    // Simple toggle logic - in a real app we'd manage tracks properly
    // For now, we'll just simulate the state
    setCaptionsEnabled(!captionsEnabled);

    // If we had tracks:
    // for (let i = 0; i < video.textTracks.length; i++) {
    //   video.textTracks[i].mode = !captionsEnabled ? 'showing' : 'hidden';
    // }
  };

  return (
    <div
      className="relative group w-full h-full flex items-center justify-center bg-black rounded-lg overflow-hidden"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="max-h-full max-w-full object-contain"
        onClick={togglePlay}
        playsInline
        loop
      >
        {/* Placeholder for captions track */}
        <track kind="captions" src="" label="English" />
      </video>

      {/* Custom Controls Overlay */}
      <div className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex flex-col space-y-2">
          {/* Progress Bar */}
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={handleSeek}
            className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:rounded-full"
          />

          <div className="flex items-center justify-between text-white">
            <div className="flex items-center space-x-4">
              <button onClick={togglePlay} className="hover:text-emerald-400 transition-colors">
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                )}
              </button>

              <button onClick={toggleMute} className="hover:text-emerald-400 transition-colors">
                {isMuted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                )}
              </button>

              <span className="text-xs font-mono opacity-70">
                {new Date(progress / 100 * duration * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
              </span>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={toggleCaptions}
                className={`text-xs font-bold border border-white/30 rounded px-1.5 py-0.5 transition-all ${captionsEnabled ? 'bg-white text-black border-white' : 'hover:bg-white/10'}`}
                title="Closed Captions"
              >
                CC
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CloudProviderButton = ({ icon: Icon, name }) => (
  <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono text-white/60 hover:bg-white/5 hover:text-white transition-all border border-transparent hover:border-white/5 group">
    <div className="flex items-center space-x-3">
      <Icon size={14} />
      <span>{name}</span>
    </div>
    <Download size={12} className="opacity-0 group-hover:opacity-50" />
  </button>
);

const App = () => {
  const [photos, setPhotos] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [viewMode, setViewMode] = useState('all'); // all, year, month, photos, videos, favorites, album:{id}
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [uploadStatus, setUploadStatus] = useState('');

  // Selection & Management State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);

  // Load photos and albums on startup
  useEffect(() => {
    loadPhotosFromDatabase();
    loadAlbums();
  }, []);

  const loadAlbums = async () => {
    try {
      const result = await invoke('get_albums');
      setAlbums(result);
    } catch (err) {
      console.error("Failed to load albums:", err);
    }
  };

  const loadPhotosFromDatabase = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await invoke('get_all_photos');
      const processedPhotos = result.map(p => ({
        id: p.path,
        url: convertFileSrc(p.path),
        date: p.date_taken,
        name: p.name,
        width: p.width,
        height: p.height,
        path: p.path,
        is_favorite: p.is_favorite,
        mediaType: p.name.match(/\.(mp4|mov|avi|webm|mkv)$/i) ? 'video' : 'photo'
      }));
      setPhotos(processedPhotos);
    } catch (err) {
      // If database is empty or doesn't exist yet, that's okay
      console.log('No photos in database yet:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFavorite = async (photo) => {
    try {
      const newStatus = !photo.is_favorite;
      // Optimistic update
      setPhotos(prev => prev.map(p => p.path === photo.path ? { ...p, is_favorite: newStatus } : p));
      if (selectedPhoto && selectedPhoto.path === photo.path) {
        setSelectedPhoto({ ...selectedPhoto, is_favorite: newStatus });
      }

      await invoke('toggle_favorite', { path: photo.path, isFavorite: newStatus });
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      // Revert on error
      loadPhotosFromDatabase();
    }
  };

  const handleCreateAlbum = async (name) => {
    try {
      await invoke('create_album', { name });
      loadAlbums();
    } catch (err) {
      console.error("Failed to create album:", err);
    }
  };

  const handleAddToAlbum = async (albumId) => {
    try {
      const paths = Array.from(selectedPhotos);
      await invoke('add_to_album', { albumId, photoPaths: paths });

      loadAlbums();
      setSelectionMode(false);
      setSelectedPhotos(new Set());
      setShowAddToAlbum(false);
      setUploadStatus(`Added ${paths.length} items to album`);
      setTimeout(() => setUploadStatus(''), 3000);
    } catch (err) {
      console.error("Failed to add to album:", err);
      setError("Failed to add to album");
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedPhotos.size} items? This cannot be undone.`)) return;

    try {
      const paths = Array.from(selectedPhotos);
      await invoke('delete_photos', { paths });

      setPhotos(prev => prev.filter(p => !selectedPhotos.has(p.path)));
      setSelectionMode(false);
      setSelectedPhotos(new Set());
      loadAlbums(); // Update counts
    } catch (err) {
      console.error("Failed to delete photos:", err);
      setError("Failed to delete items");
    }
  };

  const toggleSelection = (path) => {
    const newSet = new Set(selectedPhotos);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    setSelectedPhotos(newSet);
    setLastSelectedPath(path);
  };

  const handlePhotoClick = (photo, e) => {
    // Handle Command/Control Click (Toggle individual)
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      if (!selectionMode) setSelectionMode(true);
      toggleSelection(photo.path);
      return;
    }

    // Handle Shift Click (Range selection)
    if (e.shiftKey && lastSelectedPath) {
      e.stopPropagation();
      if (!selectionMode) setSelectionMode(true);

      const currentIndex = flatVisiblePhotos.findIndex(p => p.path === photo.path);
      const lastIndex = flatVisiblePhotos.findIndex(p => p.path === lastSelectedPath);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const range = flatVisiblePhotos.slice(start, end + 1);

        const newSet = new Set(selectedPhotos);
        range.forEach(p => newSet.add(p.path));
        setSelectedPhotos(newSet);
        // Don't update lastSelectedPath on range select to allow extending range from original anchor? 
        // Or update it? Standard behavior usually updates it.
        // Let's update it to the clicked one.
        setLastSelectedPath(photo.path);
      }
      return;
    }

    // Normal Click
    if (selectionMode) {
      toggleSelection(photo.path);
    } else {
      setSelectedPhoto(photo);
      setLastSelectedPath(photo.path);
    }
  };

  const handleUploadPhotos = async () => {
    try {
      setUploadStatus('Selecting files...');
      setError(null);

      // Open file dialog for multiple image selection
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Media',
          extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'bmp', 'mp4', 'mov', 'avi', 'webm', 'mkv']
        }]
      });

      if (!selected || selected.length === 0) {
        setUploadStatus('');
        return;
      }

      setLoading(true);
      setUploadStatus(`Uploading ${selected.length} photos...`);

      // Upload photos to managed library
      const uploaded = await invoke('upload_photos', { filePaths: selected });

      setUploadStatus(`Successfully uploaded ${uploaded.length} photos!`);

      // Reload from database to show uploaded photos in chronological order
      await loadPhotosFromDatabase();

      // Clear status after 3 seconds
      setTimeout(() => setUploadStatus(''), 3000);
    } catch (err) {
      setError(`Failed to upload photos: ${err}`);
      console.error('Upload error:', err);
      setUploadStatus('');
    } finally {
      setLoading(false);
    }
  };

  // Sort photos chronologically and group them
  const groupedPhotos = useMemo(() => {
    // First, sort all photos by date (newest first)
    const sortedPhotos = [...photos].sort((a, b) => b.date - a.date);

    const groups = {};
    sortedPhotos.forEach(photo => {
      const date = new Date(photo.date * 1000);
      let key = 'All Photos';
      if (viewMode === 'year') key = date.getFullYear().toString();
      else if (viewMode === 'month') key = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      // Filter based on viewMode
      if (viewMode === 'photos' && photo.mediaType !== 'photo') return;
      if (viewMode === 'videos' && photo.mediaType !== 'video') return;
      if (viewMode === 'favorites' && !photo.is_favorite) return;

      // Note: Album filtering would need to happen before this or we need to fetch album photos separately
      // For simplicity, if viewMode starts with 'album:', we should probably handle it differently
      // But for now let's assume we just filter the main list if we had loaded album photos
      // A better approach for albums is to fetch only album photos when in album view.

      if (!groups[key]) groups[key] = [];
      groups[key].push(photo);
    });
    return Object.entries(groups);
  }, [photos, viewMode]);

  // Flatten visible photos for range selection
  const flatVisiblePhotos = useMemo(() => {
    return groupedPhotos.flatMap(([_, items]) => items);
  }, [groupedPhotos]);

  // Special effect for album view
  useEffect(() => {
    if (viewMode.startsWith('album:')) {
      const albumId = parseInt(viewMode.split(':')[1]);
      const loadAlbumPhotos = async () => {
        setLoading(true);
        try {
          const result = await invoke('get_album_photos', { albumId });
          const processed = result.map(p => ({
            id: p.path,
            url: convertFileSrc(p.path),
            date: p.date_taken,
            name: p.name,
            width: p.width,
            height: p.height,
            path: p.path,
            is_favorite: p.is_favorite,
            mediaType: p.name.match(/\.(mp4|mov|avi|webm|mkv)$/i) ? 'video' : 'photo'
          }));
          setPhotos(processed);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      loadAlbumPhotos();
    } else if (viewMode !== 'album:' && photos.length === 0 && viewMode !== 'all') {
      // If switching back from album view, reload all
      loadPhotosFromDatabase();
    } else if (viewMode === 'all' || viewMode === 'photos' || viewMode === 'videos' || viewMode === 'favorites') {
      // Ensure we have all photos loaded if we were in album view
      // This is a bit naive, ideally we cache "all photos" separately from "current view photos"
      // For now, let's just reload if we suspect we are in a filtered state
      if (photos.length < 100 && !loading) { // Heuristic
        loadPhotosFromDatabase();
      }
    }
  }, [viewMode]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  useEffect(() => {
    const initial = {};
    groupedPhotos.forEach(([key]) => initial[key] = true);
    setExpandedGroups(initial);
  }, [groupedPhotos]);

  return (
    <div className="min-h-screen text-gray-100 font-sans selection:bg-white/20 selection:text-white">
      <DitherBackground />

      {/* Sidebar */}
      <div className="fixed left-4 top-4 bottom-4 w-64 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl shadow-2xl flex flex-col z-20 overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-emerald-200 to-white/50 bg-clip-text text-transparent">TERRA</h1>
          <div className="text-xs text-white/40 font-mono mt-1 tracking-widest">LOCAL LIBRARY</div>
          {photos.length > 0 && (
            <div className="mt-2 text-xs text-emerald-400/60 font-mono">{photos.length} photos</div>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {/* Upload Photos Button - Moved to top */}
          <button
            onClick={handleUploadPhotos}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 hover:border-emerald-400/50 disabled:opacity-50 shadow-lg shadow-emerald-500/10"
          >
            <Upload size={20} />
            <span>Upload Photos</span>
          </button>

          {/* Status Messages */}
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
          <button onClick={() => setViewMode('favorites')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'favorites' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
            <Heart size={18} /> <span>Favorites</span>
          </button>

          <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2 flex justify-between items-center">
            <span>Albums</span>
            <button onClick={() => setShowCreateAlbum(true)} className="hover:text-white transition-colors"><Plus size={14} /></button>
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

          <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Filter</div>
          <button onClick={() => setViewMode('photos')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'photos' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
            <ImageIcon size={18} /> <span>Photos Only</span>
          </button>
          <button onClick={() => setViewMode('videos')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'videos' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></svg> <span>Videos Only</span>
          </button>

          <div className="mt-8 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2">Cloud Import</div>
          <div className="space-y-1">
            <CloudProviderButton icon={Cloud} name="iCloud Photos" />
            <CloudProviderButton icon={ImageIcon} name="Google Photos" />
            <CloudProviderButton icon={HardDrive} name="Dropbox / Drive" />
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="pl-72 pr-4 py-4 min-h-screen">
        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"></div>
            <div className="font-mono text-sm text-white/50 animate-pulse">{uploadStatus || 'Processing...'}</div>
          </div>
        ) : photos.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
            <Camera size={48} className="text-white/20" />
            <div className="font-mono text-sm text-white/50 text-center">
              No photos in library yet.<br />
              Click "Upload Photos" to get started.
            </div>
          </div>
        ) : (
          <div className="space-y-8 pb-20">
            {groupedPhotos.map(([groupKey, groupItems]) => (
              <div key={groupKey} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center space-x-2 mb-4 cursor-pointer select-none group" onClick={() => toggleGroup(groupKey)}>
                  <div className={`p-1 rounded bg-white/5 group-hover:bg-white/10 transition-colors`}>
                    {expandedGroups[groupKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <h2 className="text-xl font-light tracking-wide text-white/90">{groupKey}</h2>
                  <div className="h-px flex-grow bg-gradient-to-r from-white/20 to-transparent ml-4"></div>
                  <span className="text-xs font-mono text-white/40">{groupItems.length} items</span>
                </div>

                {expandedGroups[groupKey] && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {groupItems.map((photo) => (
                      <div
                        key={photo.id}
                        onClick={(e) => handlePhotoClick(photo, e)}
                        className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-white/5 border transition-all duration-300 hover:shadow-[0_0_30px_rgba(52,211,153,0.1)] ${selectedPhotos.has(photo.path) ? 'border-emerald-500 ring-2 ring-emerald-500/50' : 'border-white/5 hover:border-white/30'}`}
                      >
                        {/* Selection Overlay - Always render but control visibility */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!selectionMode) setSelectionMode(true);
                            toggleSelection(photo.path);
                          }}
                          className={`absolute top-2 left-2 z-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 transition-all cursor-pointer hover:bg-black/70 ${selectedPhotos.has(photo.path)
                              ? 'opacity-100 text-emerald-400'
                              : selectionMode
                                ? 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white'
                                : 'opacity-0 group-hover:opacity-100 text-white/30 hover:text-white translate-y-[-10px] group-hover:translate-y-0'
                            }`}
                        >
                          <CheckCircle size={20} fill={selectedPhotos.has(photo.path) ? "currentColor" : "none"} />
                        </div>

                        <img src={photo.url} alt={photo.name} loading="lazy" className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100 ${selectedPhotos.has(photo.path) ? 'scale-95' : ''}`} />


                        {/* Favorite Indicator */}
                        {!selectionMode && photo.is_favorite && (
                          <div className="absolute top-2 left-2 z-10 text-red-500 drop-shadow-lg">
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
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selection Toolbar */}
      {selectionMode && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-[#1a1a1a]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl px-6 py-3 flex items-center space-x-6 z-40 animate-in slide-in-from-bottom-10">
          <div className="text-sm font-mono text-white/60 border-r border-white/10 pr-6">
            <span className="text-white font-bold">{selectedPhotos.size}</span> selected
          </div>

          <button onClick={() => setShowAddToAlbum(true)} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-white transition-colors disabled:opacity-30">
            <Folder size={20} />
            <span className="text-[10px] uppercase tracking-wider">Add to Album</span>
          </button>

          <button onClick={handleDeleteSelected} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-red-400 transition-colors disabled:opacity-30">
            <Trash2 size={20} />
            <span className="text-[10px] uppercase tracking-wider">Delete</span>
          </button>

          <div className="w-px h-8 bg-white/10"></div>

          <button onClick={() => { setSelectionMode(false); setSelectedPhotos(new Set()); }} className="flex flex-col items-center space-y-1 text-white/60 hover:text-white transition-colors">
            <X size={20} />
            <span className="text-[10px] uppercase tracking-wider">Cancel</span>
          </button>
        </div>
      )}

      {/* Floating Action Button for Selection Mode */}
      {!selectionMode && (
        <button
          onClick={() => setSelectionMode(true)}
          className="fixed bottom-8 right-8 bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-full shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 z-30"
          title="Select Photos"
        >
          <CheckCircle size={24} />
        </button>
      )}

      <PhotoModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} onToggleFavorite={handleToggleFavorite} />
      <CreateAlbumModal isOpen={showCreateAlbum} onClose={() => setShowCreateAlbum(false)} onCreate={handleCreateAlbum} />
      <AddToAlbumModal isOpen={showAddToAlbum} onClose={() => setShowAddToAlbum(false)} albums={albums} onSelect={handleAddToAlbum} />
    </div>
  );
};

export default App;
