import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Camera, Calendar, Grid, Image as ImageIcon, X,
  ChevronDown, ChevronRight, Cloud, Download, HardDrive, Upload
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

const PhotoModal = ({ photo, onClose }) => {
  if (!photo) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full h-full flex flex-col items-center justify-center p-8">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10">
          <X size={24} />
        </button>
        <img src={photo.url} alt={photo.name} className="max-h-[85vh] max-w-[90vw] shadow-2xl border border-white/10 rounded-lg object-contain" />
        <div className="mt-4 flex flex-col items-center text-white/70 font-mono text-sm">
          <span className="text-white font-bold tracking-wider">{photo.name}</span>
          <span>{new Date(photo.date * 1000).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
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
  const [viewMode, setViewMode] = useState('all');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [uploadStatus, setUploadStatus] = useState('');

  // Load photos from database on startup
  useEffect(() => {
    loadPhotosFromDatabase();
  }, []);

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
        path: p.path
      }));
      setPhotos(processedPhotos);
    } catch (err) {
      // If database is empty or doesn't exist yet, that's okay
      console.log('No photos in database yet:', err);
    } finally {
      setLoading(false);
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
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'bmp']
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

      if (!groups[key]) groups[key] = [];
      groups[key].push(photo);
    });
    return Object.entries(groups);
  }, [photos, viewMode]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({...prev, [groupKey]: !prev[groupKey]}));
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
                      <div key={photo.id} onClick={() => setSelectedPhoto(photo)} className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-white/5 border border-white/5 hover:border-white/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(52,211,153,0.1)]">
                        <img src={photo.url} alt={photo.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                          <p className="text-xs font-mono text-white truncate">{photo.name}</p>
                          <p className="text-[10px] font-mono text-white/60">{new Date(photo.date * 1000).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <PhotoModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
};

export default App;
