import React, { useState, useEffect, useRef, useMemo, Component } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Camera, Calendar, Grid, Image as ImageIcon, X,
  ChevronDown, ChevronRight, Cloud, Download, HardDrive, Upload, Play,
  Heart, Plus, Trash2, Folder, CheckCircle, AlertTriangle, RefreshCw,
  Copy, MonitorSmartphone, Archive, RotateCcw, Tag, Eye, BarChart3, Settings
} from 'lucide-react';
import { processPhotos } from './utils/photoHelpers';
import SettingsModal from './components/SettingsModal';
import { TagCreateModal, TagAssignPopover, PhotoTagBar } from './components/TagManager';
import SmartCollections from './components/SmartCollections';
import StorageAnalytics from './components/StorageAnalytics';
import TerraFormReview from './components/TerraFormReview';

// --- CONFIGURATION ---
const CONFIG = {
  /** Target frames per second for background animation */
  ANIMATION_FPS: 24,
  /** Debounce delay in milliseconds for search input */
  SEARCH_DEBOUNCE_MS: 300,
  /** Duration in milliseconds to show status messages */
  STATUS_TIMEOUT_MS: 3000,
  /** Hamming distance threshold for duplicate detection (must match backend) */
  DUPLICATE_THRESHOLD: 10,
};

// --- ERROR BOUNDARY ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Terra Error Boundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
            <p className="text-white/60 text-sm">
              Terra encountered an unexpected error. This has been logged for debugging.
            </p>
            {this.state.error && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-left">
                <p className="text-xs font-mono text-red-400 break-all">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
            >
              <RefreshCw size={18} />
              <span>Reload App</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- COMPONENTS ---

const DitherBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency
    let animationFrameId;
    let isVisible = true;
    let lastFrameTime = 0;
    const frameInterval = 1000 / CONFIG.ANIMATION_FPS;
    const chars = " .:-=+*#%@";

    // Increased cell size to reduce draw calls significantly (4x fewer calls)
    const charWidth = 20;
    const charHeight = 24;
    const fontSize = 20;

    const resize = () => {
      // Handle high DPI displays properly but keep internal resolution lower for performance
      const dpr = window.devicePixelRatio || 1;
      // We don't scale up the canvas context for the background effect to save performance
      // Just set the display size
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    // Pause animation when tab is hidden
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && !animationFrameId) {
        lastFrameTime = performance.now();
        animationFrameId = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Create fewer bubbles for better performance
    const bubbles = [];
    const bubbleCount = Math.floor(Math.random() * 3) + 4; // 4-6 bubbles

    for (let i = 0; i < bubbleCount; i++) {
      bubbles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 100 + 50, // Larger bubbles since we have fewer
        speed: 0.002 // Slower, smoother movement
      });
    }

    const render = (currentTime) => {
      // Stop rendering if tab is hidden
      if (!isVisible) {
        animationFrameId = null;
        return;
      }

      // Throttle to target FPS
      const elapsed = currentTime - lastFrameTime;
      if (elapsed < frameInterval) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = currentTime - (elapsed % frameInterval);

      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#2a2a2a';
      ctx.font = `${fontSize}px monospace`;

      const cols = Math.ceil(canvas.width / charWidth);
      const rows = Math.ceil(canvas.height / charHeight);

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
      // Optimization: Only scan the area around bubbles instead of the whole screen?
      // For now, the reduced grid size should be enough.

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const pixelX = x * charWidth;
          const pixelY = y * charHeight;

          // Check distance to each bubble
          let closestDist = Infinity;

          // Simple optimization: check if pixel is vaguely near any bubble before precise calc
          // Actually, for small number of bubbles, just checking all is fine.

          for (let i = 0; i < bubbles.length; i++) {
            const bubble = bubbles[i];
            const dx = pixelX - bubble.x;
            const dy = pixelY - bubble.y;

            // Manhattan distance check first for speed? 
            if (Math.abs(dx) > bubble.radius && Math.abs(dy) > bubble.radius) continue;

            const dist = Math.sqrt(dx * dx + dy * dy);
            const normalizedDist = dist / bubble.radius;

            if (normalizedDist < closestDist) {
              closestDist = normalizedDist;
            }
          }

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
    animationFrameId = requestAnimationFrame(render);

    return () => {
      // Stop animation
      isVisible = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      // Remove event listeners
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // Clear canvas to release memory
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }

      // Clear bubbles array
      bubbles.length = 0;
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

// --- SCAN MODAL ---
const ScanModal = ({ isOpen, onClose, title, progress, phase, icon: Icon }) => {
  if (!isOpen) return null;

  const getPhaseText = () => {
    switch (phase) {
      case 'hashing': return 'Analyzing photos...';
      case 'analyzing': return 'Detecting patterns...';
      case 'saving': return 'Saving results...';
      case 'complete': return 'Scan complete!';
      default: return 'Processing...';
    }
  };

  const percentage = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-8 rounded-xl w-full max-w-md shadow-2xl text-center">
        <div className="w-20 h-20 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full border-4 border-white/10"></div>
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="rgb(52, 211, 153)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.89} 289`}
              className="transition-all duration-300"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {phase === 'complete' ? (
              <CheckCircle size={32} className="text-emerald-400" />
            ) : (
              <Icon size={32} className="text-white/60 animate-pulse" />
            )}
          </div>
        </div>

        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        <p className="text-white/60 text-sm mb-4">{getPhaseText()}</p>

        <div className="bg-white/5 rounded-full h-2 mb-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>

        <p className="text-xs font-mono text-white/40">
          {progress.processed} / {progress.total} photos
        </p>

        {phase === 'complete' && (
          <button
            onClick={onClose}
            className="mt-6 px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            View Results
          </button>
        )}
      </div>
    </div>
  );
};

// --- DUPLICATE REVIEW GALLERY ---
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
        {/* Header */}
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

        {/* Content */}
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

                  {/* Thumbnail preview row */}
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

                  {/* Expanded view */}
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

      {/* Confirmation Dialog */}
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

// --- SCREENSHOT REVIEW GALLERY ---
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
        {/* Header */}
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

        {/* Content */}
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

      {/* Confirmation Dialog */}
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

// --- ARCHIVE VIEW ---
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
        {/* Header */}
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

        {/* Content */}
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
            <img
              src={photo.url}
              alt={photo.name}
              className="max-h-full max-w-full shadow-2xl border border-white/10 rounded-lg object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
              }}
            />
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
          <PhotoTagBar photoPath={photo.path} />
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
  const [videoError, setVideoError] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset error state when src changes
    setVideoError(null);

    const updateProgress = () => {
      setProgress((video.currentTime / video.duration) * 100);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleError = (e) => {
      console.error('Video playback error:', e);
      setVideoError('Failed to load video');
    };

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);

    if (autoPlay) {
      video.play().catch(() => {/* Autoplay may be prevented by browser */});
    }

    return () => {
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
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

  // Show error state if video failed to load
  if (videoError) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-black/50 rounded-lg">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <p className="text-white/70 text-sm">{videoError}</p>
          <p className="text-white/40 text-xs">The video file may be corrupted or in an unsupported format.</p>
        </div>
      </div>
    );
  }

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
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [lastSelectedPath, setLastSelectedPath] = useState(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);

  // New feature state
  const [showSettings, setShowSettings] = useState(false);
  const [libraryPath, setLibraryPath] = useState('');
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [showTagCreate, setShowTagCreate] = useState(false);
  const [editTag, setEditTag] = useState(null);
  const [showTagAssign, setShowTagAssign] = useState(false);
  const [smartCollections, setSmartCollections] = useState([]);
  const [showStorageAnalytics, setShowStorageAnalytics] = useState(false);
  const [showTerraForm, setShowTerraForm] = useState(false);
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  // Duplicate and screenshot detection state
  const [showDuplicateScan, setShowDuplicateScan] = useState(false);
  const [showScreenshotScan, setShowScreenshotScan] = useState(false);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);
  const [showScreenshotReview, setShowScreenshotReview] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [scanProgress, setScanProgress] = useState({ total: 0, processed: 0 });
  const [scanPhase, setScanPhase] = useState('');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [archivedPhotos, setArchivedPhotos] = useState([]);

  // Ref for timeout cleanup to prevent memory leaks
  const statusTimeoutRef = useRef(null);

  // Ref to track if component is mounted (prevents state updates after unmount)
  const isMountedRef = useRef(true);

  // Ref for search debouncing
  const searchDebounceRef = useRef(null);

  // Helper to set status with auto-clear
  const setStatusWithTimeout = (message, duration = CONFIG.STATUS_TIMEOUT_MS) => {
    // Clear any existing timeout
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setUploadStatus(message);
    if (message) {
      statusTimeoutRef.current = setTimeout(() => {
        setUploadStatus('');
        statusTimeoutRef.current = null;
      }, duration);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  // Load photos and albums on startup
  useEffect(() => {
    loadPhotosFromDatabase();
    loadAlbums();
    loadLocations();
    loadTags();
    loadSmartCollections();
    invoke('get_library_path_command').then(setLibraryPath).catch(console.error);
    invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
  }, []);

  const loadAlbums = async () => {
    try {
      const result = await invoke('get_albums');
      setAlbums(result);
    } catch (err) {
      console.error("Failed to load albums:", err);
    }
  };

  const loadLocations = async () => {
    try {
      const result = await invoke('get_locations');
      setLocations(result);
    } catch (err) {
      console.error("Failed to load locations:", err);
    }
  };

  const loadTags = async () => {
    try {
      const result = await invoke('get_all_tags');
      setTags(result);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  };

  const loadSmartCollections = async () => {
    try {
      const result = await invoke('get_smart_collections');
      setSmartCollections(result);
    } catch (err) {
      console.error("Failed to load smart collections:", err);
    }
  };

  const loadPhotosFromDatabase = async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const result = await invoke('get_all_photos');
      if (!isMountedRef.current) return; // Check after async

      setPhotos(processPhotos(result));
    } catch {
      // Database may be empty or not exist yet on first run
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleSearch = (query) => {
    setSearchQuery(query);

    // Clear any pending search
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!query.trim()) {
      loadPhotosFromDatabase();
      return;
    }

    // Debounce search
    searchDebounceRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;

      setLoading(true);
      try {
        const result = await invoke('search_photos', { query });
        if (!isMountedRef.current) return; // Check again after async

        setPhotos(processPhotos(result));
        setViewMode('search');
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }, CONFIG.SEARCH_DEBOUNCE_MS);
  };

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const result = await invoke('get_duplicates');
      setPhotos(processPhotos(result));
      setViewMode('duplicates');
    } catch (err) {
      console.error("Failed to load duplicates:", err);
    } finally {
      setLoading(false);
    }
  };

  // --- DUPLICATE AND SCREENSHOT SCAN HANDLERS ---
  const handleScanForDuplicates = async () => {
    setShowDuplicateScan(true);
    setScanProgress({ total: 0, processed: 0 });
    setScanPhase('hashing');

    // Listen for progress events
    const unlisten = await listen('scan_progress', (event) => {
      setScanProgress({ total: event.payload.total, processed: event.payload.processed });
      setScanPhase(event.payload.phase);
    });

    try {
      await invoke('scan_for_duplicates');
      // Fetch duplicate groups after scan
      const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
      setDuplicateGroups(groups);
      setScanPhase('complete');
    } catch (err) {
      console.error("Failed to scan for duplicates:", err);
      setShowDuplicateScan(false);
      setError("Failed to scan for duplicates");
    } finally {
      unlisten();
    }
  };

  const handleDuplicateScanComplete = () => {
    setShowDuplicateScan(false);
    setShowDuplicateReview(true);
  };

  const handleScanForScreenshots = async () => {
    setShowScreenshotScan(true);
    setScanProgress({ total: 0, processed: 0 });
    setScanPhase('analyzing');

    // Listen for progress events
    const unlisten = await listen('screenshot_scan_progress', (event) => {
      setScanProgress({ total: event.payload.total, processed: event.payload.processed });
      setScanPhase(event.payload.phase);
    });

    try {
      const result = await invoke('scan_for_screenshots');
      setScreenshots(result);
      setScanPhase('complete');
    } catch (err) {
      console.error("Failed to scan for screenshots:", err);
      setShowScreenshotScan(false);
      setError("Failed to scan for screenshots");
    } finally {
      unlisten();
    }
  };

  const handleScreenshotScanComplete = () => {
    setShowScreenshotScan(false);
    setShowScreenshotReview(true);
  };

  const handleArchivePhotos = async (paths) => {
    try {
      await invoke('archive_photos', { paths });
      setStatusWithTimeout(`Archived ${paths.length} photos`);
      // Refresh data
      loadPhotosFromDatabase();
      // Refresh duplicate groups if in that view
      if (showDuplicateReview) {
        const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
        setDuplicateGroups(groups);
      }
      // Refresh screenshots if in that view
      if (showScreenshotReview) {
        const result = await invoke('get_screenshots');
        setScreenshots(result);
      }
    } catch (err) {
      console.error("Failed to archive photos:", err);
      setError("Failed to archive photos");
    }
  };

  const handleRestorePhotos = async (paths) => {
    try {
      await invoke('restore_photos', { paths });
      setStatusWithTimeout(`Restored ${paths.length} photos`);
      loadPhotosFromDatabase();
      loadArchivedPhotos();
    } catch (err) {
      console.error("Failed to restore photos:", err);
      setError("Failed to restore photos");
    }
  };

  const loadArchivedPhotos = async () => {
    try {
      const result = await invoke('get_archived_photos');
      setArchivedPhotos(result);
    } catch (err) {
      console.error("Failed to load archived photos:", err);
    }
  };

  const handleOpenArchive = () => {
    loadArchivedPhotos();
    setShowArchive(true);
  };

  const refreshDuplicateGroups = async () => {
    try {
      const groups = await invoke('get_duplicate_groups', { threshold: CONFIG.DUPLICATE_THRESHOLD });
      setDuplicateGroups(groups);
    } catch (err) {
      console.error("Failed to refresh duplicate groups:", err);
    }
  };

  const refreshScreenshots = async () => {
    try {
      const result = await invoke('get_screenshots');
      setScreenshots(result);
    } catch (err) {
      console.error("Failed to refresh screenshots:", err);
    }
  };

  // Run archive cleanup on startup
  useEffect(() => {
    invoke('cleanup_old_archives').catch(err => {
      console.error("Failed to cleanup archives:", err);
    });
  }, []);

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
      setStatusWithTimeout(`Added ${paths.length} items to album`);
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
      loadLocations(); // Update location counts
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

      // Reload from database to show uploaded photos in chronological order
      await loadPhotosFromDatabase();
      loadLocations(); // Update locations

      setStatusWithTimeout(`Successfully uploaded ${uploaded.length} photos!`);
    } catch (err) {
      setError(`Failed to upload photos: ${err}`);
      console.error('Upload error:', err);
      setUploadStatus('');
    } finally {
      setLoading(false);
    }
  };

  // Group photos - backend already sorts by date_taken DESC
  const groupedPhotos = useMemo(() => {
    const groups = {};

    if (viewMode === 'duplicates') {
      // Group by hash
      photos.forEach(photo => {
        if (!photo.hash) return;
        const key = `Duplicate Group: ${photo.hash.substring(0, 8)}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(photo);
      });
      return Object.entries(groups);
    }

    if (viewMode === 'locations') {
      // Group by location
      photos.forEach(photo => {
        const key = photo.location || 'Unknown Location';
        if (!groups[key]) groups[key] = [];
        groups[key].push(photo);
      });
      // Sort locations by count
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (viewMode === 'tags') {
      groups['Tagged Photos'] = photos;
      return Object.entries(groups);
    }

    if (viewMode.startsWith('collection:')) {
      const collectionId = viewMode.split(':')[1];
      const collection = smartCollections.find(c => c.id === collectionId);
      groups[collection ? collection.name : 'Smart Collection'] = photos;
      return Object.entries(groups);
    }

    photos.forEach(photo => {
      const date = new Date(photo.date * 1000);
      let key = 'All Photos';
      if (viewMode === 'year') key = date.getFullYear().toString();
      else if (viewMode === 'month') key = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      else if (viewMode === 'search') key = 'Search Results';

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
  }, [photos, viewMode, smartCollections]);

  // Flatten visible photos for range selection
  const flatVisiblePhotos = useMemo(() => {
    return groupedPhotos.flatMap(([_, items]) => items);
  }, [groupedPhotos]);

  // Track if we're viewing a filtered subset of photos (albums, duplicates, search)
  // These views load their own data, so we need to reload all photos when leaving them
  const wasFilteredViewRef = useRef(false);

  // Handle view mode changes
  useEffect(() => {
    const isCurrentlyAlbum = viewMode.startsWith('album:');
    const isCurrentlyCollection = viewMode.startsWith('collection:');
    const isFilteredView = isCurrentlyAlbum || isCurrentlyCollection || viewMode === 'duplicates' || viewMode === 'search' || viewMode === 'tags';
    const isRegularView = ['all', 'year', 'month', 'photos', 'videos', 'favorites', 'locations'].includes(viewMode);

    if (isCurrentlyAlbum) {
      const albumId = parseInt(viewMode.split(':')[1]);
      wasFilteredViewRef.current = true;
      const loadAlbumPhotos = async () => {
        setLoading(true);
        try {
          const result = await invoke('get_album_photos', { albumId });
          setPhotos(processPhotos(result));
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      loadAlbumPhotos();
    } else if (isCurrentlyCollection) {
      const collectionId = viewMode.split(':')[1];
      wasFilteredViewRef.current = true;
      const loadCollectionPhotos = async () => {
        setLoading(true);
        try {
          const result = await invoke('get_smart_collection_photos', { collectionId });
          setPhotos(processPhotos(result));
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      loadCollectionPhotos();
    } else if (viewMode === 'tags') {
      wasFilteredViewRef.current = true;
      if (selectedTagIds.length > 0) {
        const loadTagPhotos = async () => {
          setLoading(true);
          try {
            const result = await invoke('get_photos_by_tags', { tagIds: selectedTagIds, matchAll: false });
            setPhotos(processPhotos(result));
          } catch (err) {
            console.error(err);
          } finally {
            setLoading(false);
          }
        };
        loadTagPhotos();
      }
    } else if (viewMode === 'duplicates' || viewMode === 'search') {
      // Mark that we're in a filtered view (data loading handled by loadDuplicates/handleSearch)
      wasFilteredViewRef.current = true;
    } else if (wasFilteredViewRef.current && isRegularView) {
      // Switching FROM a filtered view (album/duplicates/search) TO a regular view
      // Need to reload all photos from database
      wasFilteredViewRef.current = false;
      loadPhotosFromDatabase();
    }
  }, [viewMode]); // Only depend on viewMode - ref doesn't need to be in deps

  // Reload tag photos when selectedTagIds changes
  useEffect(() => {
    if (viewMode !== 'tags' || selectedTagIds.length === 0) return;
    const loadTagPhotos = async () => {
      setLoading(true);
      try {
        const result = await invoke('get_photos_by_tags', { tagIds: selectedTagIds, matchAll: false });
        setPhotos(processPhotos(result));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadTagPhotos();
  }, [selectedTagIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  // Track previous group keys to avoid infinite re-renders
  const prevGroupKeysRef = useRef('');

  useEffect(() => {
    // Create a stable string key from group names to compare
    const currentKeys = groupedPhotos.map(([key]) => key).join('|');

    // Only update if the actual group keys changed, not just the array reference
    if (currentKeys !== prevGroupKeysRef.current) {
      prevGroupKeysRef.current = currentKeys;
      const initial = {};
      groupedPhotos.forEach(([key]) => {
        // Preserve existing expanded state, default new groups to expanded
        initial[key] = expandedGroups[key] !== undefined ? expandedGroups[key] : true;
      });
      setExpandedGroups(initial);
    }
  }, [groupedPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen text-gray-100 font-sans selection:bg-white/20 selection:text-white">
      <DitherBackground />

      {/* Sidebar */}
      <div className="fixed left-4 top-4 bottom-4 w-64 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl shadow-2xl flex flex-col z-20 overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-emerald-200 to-white/50 bg-clip-text text-transparent">TERRA</h1>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
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

          {/* Search Bar */}
          <div className="relative mt-4 mb-2">
            <input
              type="text"
              placeholder="Search photos..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 pl-9"
            />
            <div className="absolute left-3 top-2.5 text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
          </div>

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
          <button onClick={() => setViewMode('locations')} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all ${viewMode === 'locations' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> <span>Locations</span>
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

          {/* Tags */}
          <div className="pt-4 text-xs font-mono text-white/30 uppercase tracking-widest mb-2 px-2 flex justify-between items-center">
            <span>Tags</span>
            <button onClick={() => { setEditTag(null); setShowTagCreate(true); }} className="hover:text-white transition-colors"><Plus size={14} /></button>
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

          {/* Smart Collections */}
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
          <button onClick={handleScanForDuplicates} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
            <Copy size={18} /> <span>Find Duplicates</span>
          </button>
          <button onClick={handleScanForScreenshots} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
            <MonitorSmartphone size={18} /> <span>Find Screenshots</span>
          </button>
          <button onClick={handleOpenArchive} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
            <Archive size={18} /> <span>View Archive</span>
          </button>
          <button onClick={() => setShowTerraForm(true)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
            <div className="flex items-center space-x-3">
              <Eye size={18} />
              <span>TerraForm Review</span>
            </div>
            {unreviewedCount > 0 && (
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">{unreviewedCount}</span>
            )}
          </button>
          <button onClick={() => setShowStorageAnalytics(true)} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm transition-all text-white/60 hover:bg-white/5 hover:text-white">
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

                        <img
                          src={photo.url}
                          alt={photo.name}
                          loading="lazy"
                          className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100 ${selectedPhotos.has(photo.path) ? 'scale-95' : ''}`}
                          onError={(e) => {
                            // Replace with placeholder on error
                            e.target.onerror = null;
                            e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
                          }}
                        />


                        {/* Favorite Indicator - positioned to not overlap with video icon */}
                        {!selectionMode && photo.is_favorite && (
                          <div className={`absolute top-2 z-10 text-red-500 drop-shadow-lg ${photo.mediaType === 'video' ? 'right-10' : 'right-2'}`}>
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

          <button onClick={() => setShowTagAssign(true)} disabled={selectedPhotos.size === 0} className="flex flex-col items-center space-y-1 text-white/60 hover:text-emerald-400 transition-colors disabled:opacity-30">
            <Tag size={20} />
            <span className="text-[10px] uppercase tracking-wider">Tag</span>
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

      {/* Scan and Review Modals */}
      <ScanModal
        isOpen={showDuplicateScan}
        onClose={handleDuplicateScanComplete}
        title="Scanning for Duplicates"
        progress={scanProgress}
        phase={scanPhase}
        icon={Copy}
      />
      <ScanModal
        isOpen={showScreenshotScan}
        onClose={handleScreenshotScanComplete}
        title="Scanning for Screenshots"
        progress={scanProgress}
        phase={scanPhase}
        icon={MonitorSmartphone}
      />
      <DuplicateReviewGallery
        isOpen={showDuplicateReview}
        onClose={() => setShowDuplicateReview(false)}
        duplicateGroups={duplicateGroups}
        onArchive={handleArchivePhotos}
        onRefresh={refreshDuplicateGroups}
      />
      <ScreenshotReviewGallery
        isOpen={showScreenshotReview}
        onClose={() => setShowScreenshotReview(false)}
        screenshots={screenshots}
        onArchive={handleArchivePhotos}
        onRefresh={refreshScreenshots}
      />
      <ArchiveView
        isOpen={showArchive}
        onClose={() => setShowArchive(false)}
        archivedPhotos={archivedPhotos}
        onRestore={handleRestorePhotos}
        onRefresh={loadArchivedPhotos}
      />

      {/* Settings */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        libraryPath={libraryPath}
        onLibraryPathChange={setLibraryPath}
      />

      {/* Tags */}
      <TagCreateModal
        isOpen={showTagCreate}
        onClose={() => { setShowTagCreate(false); setEditTag(null); }}
        onSave={loadTags}
        editTag={editTag}
      />
      <TagAssignPopover
        isOpen={showTagAssign}
        onClose={() => setShowTagAssign(false)}
        photoPaths={Array.from(selectedPhotos)}
        onTagsChanged={() => {
          loadTags();
          setSelectionMode(false);
          setSelectedPhotos(new Set());
        }}
      />

      {/* TerraForm Review */}
      <TerraFormReview
        isOpen={showTerraForm}
        onClose={() => {
          setShowTerraForm(false);
          loadPhotosFromDatabase();
          invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
        }}
      />

      {/* Storage Analytics */}
      <StorageAnalytics
        isOpen={showStorageAnalytics}
        onClose={() => setShowStorageAnalytics(false)}
        onNavigateToPhoto={(path) => {
          setShowStorageAnalytics(false);
          const photo = photos.find(p => p.path === path);
          if (photo) setSelectedPhoto(photo);
        }}
        onOpenDuplicateReview={() => {
          setShowStorageAnalytics(false);
          handleScanForDuplicates();
        }}
      />
    </div>
  );
};

// Wrap App with ErrorBoundary
const AppWithErrorBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
