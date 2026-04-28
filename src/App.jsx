import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, MonitorSmartphone } from 'lucide-react';

import { CONFIG } from './config';
import ErrorBoundary from './components/ErrorBoundary';
import DitherBackground from './components/DitherBackground';
import Sidebar from './components/Sidebar';
import PhotoGrid from './components/PhotoGrid';
import SelectionToolbar from './components/SelectionToolbar';
import PhotoModal from './components/PhotoModal';
import CreateAlbumModal from './components/CreateAlbumModal';
import AddToAlbumModal from './components/AddToAlbumModal';
import ScanModal from './components/ScanModal';
import DuplicateReviewGallery from './components/DuplicateReviewGallery';
import ScreenshotReviewGallery from './components/ScreenshotReviewGallery';
import ArchiveView from './components/ArchiveView';
import SettingsModal from './components/SettingsModal';
import { TagCreateModal, TagAssignPopover } from './components/TagManager';
import StorageAnalytics from './components/StorageAnalytics';
import TerraFormReview from './components/TerraFormReview';

import { AppProvider, useAppContext } from './contexts/AppContext';
import { ViewProvider, useViewContext } from './contexts/ViewContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useSelection } from './hooks/useSelection';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const AppLayout = () => {
  const {
    photos, loading, error, uploadStatus,
    libraryPath, setLibraryPath,
    albums, handleCreateAlbum, handleAddToAlbum,
    tags, selectedTagIds, setSelectedTagIds, loadTags,
    setStatusWithTimeout, loadPhotosFromDatabase,
    handleUploadPhotos, handleToggleFavorite, handleDeleteSelected,
    loadAlbums,
    // cleanup
    showDuplicateScan, showScreenshotScan,
    showDuplicateReview, setShowDuplicateReview,
    showScreenshotReview, setShowScreenshotReview,
    showArchive, setShowArchive,
    scanProgress, scanPhase, duplicateGroups, screenshots, archivedPhotos,
    handleScanForDuplicates, handleDuplicateScanComplete,
    handleScanForScreenshots, handleScreenshotScanComplete,
    handleArchivePhotos, handleRestorePhotos, handleOpenArchive,
    refreshDuplicateGroups, refreshScreenshots, loadArchivedPhotos,
  } = useAppContext();

  const {
    viewMode, setViewMode, cycleViewMode, searchQuery, handleSearch,
    smartCollections, loadSmartCollections,
    groupedPhotos, flatVisiblePhotos, expandedGroups, toggleGroup,
    unreviewedCount, setUnreviewedCount,
    loadLocations,
  } = useViewContext();

  const {
    selectedPhotos, selectionMode, setSelectionMode,
    toggleSelection, handlePhotoClick, clearSelection,
  } = useSelection(flatVisiblePhotos);

  // Local modal state
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTagCreate, setShowTagCreate] = useState(false);
  const [editTag, setEditTag] = useState(null);
  const [showTagAssign, setShowTagAssign] = useState(false);
  const [showStorageAnalytics, setShowStorageAnalytics] = useState(false);
  const [showTerraForm, setShowTerraForm] = useState(false);

  const searchInputRef = useRef(null);

  useKeyboardShortcuts({
    enabled: !selectedPhoto,
    onFocusSearch: () => searchInputRef.current?.focus(),
    onCycleViewMode: cycleViewMode,
  });

  const onPhotoClick = (photo, e) => {
    handlePhotoClick(photo, e, setSelectedPhoto);
  };

  const onToggleSelection = (path) => {
    if (!selectionMode) setSelectionMode(true);
    toggleSelection(path);
  };

  const onToggleFavorite = (photo) => {
    handleToggleFavorite(photo, selectedPhoto, setSelectedPhoto);
  };

  const onModalArchive = useCallback((photo) => {
    handleArchivePhotos([photo.path]);
    setSelectedPhoto(null);
  }, [handleArchivePhotos]);

  const onModalDelete = useCallback((photo) => {
    if (!window.confirm('Delete this photo permanently? This cannot be undone.')) return;
    handleDeleteSelected(new Set([photo.path]), () => setSelectedPhoto(null), loadAlbums, loadLocations);
  }, [handleDeleteSelected, loadAlbums, loadLocations]);

  const onModalReveal = useCallback(async (photo) => {
    try {
      await invoke('reveal_in_finder', { path: photo.path });
    } catch (err) {
      console.error('Failed to reveal in Finder:', err);
    }
  }, []);

  const onAddToAlbum = async (albumId) => {
    try {
      await handleAddToAlbum(albumId, selectedPhotos, (count) => {
        clearSelection();
        setShowAddToAlbum(false);
        setStatusWithTimeout(`Added ${count} items to album`);
      });
    } catch {
      // error handled in hook
    }
  };

  const onDeleteSelected = () => {
    handleDeleteSelected(selectedPhotos, clearSelection, loadAlbums, loadLocations);
  };

  return (
    <div className="min-h-screen text-gray-100 font-sans selection:bg-white/20 selection:text-white">
      <DitherBackground />

      <Sidebar
        photos={photos}
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={searchQuery}
        handleSearch={handleSearch}
        searchInputRef={searchInputRef}
        albums={albums}
        tags={tags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        smartCollections={smartCollections}
        loadSmartCollections={loadSmartCollections}
        unreviewedCount={unreviewedCount}
        loading={loading}
        uploadStatus={uploadStatus}
        error={error}
        onUpload={handleUploadPhotos}
        onCreateAlbum={() => setShowCreateAlbum(true)}
        onCreateTag={() => { setEditTag(null); setShowTagCreate(true); }}
        onSettings={() => setShowSettings(true)}
        onScanDuplicates={handleScanForDuplicates}
        onScanScreenshots={handleScanForScreenshots}
        onOpenArchive={handleOpenArchive}
        onOpenTerraForm={() => setShowTerraForm(true)}
        onOpenStorageAnalytics={() => setShowStorageAnalytics(true)}
      />

      <div className="pl-72 pr-4 py-4 min-h-screen">
        <PhotoGrid
          loading={loading}
          photos={photos}
          groupedPhotos={groupedPhotos}
          expandedGroups={expandedGroups}
          toggleGroup={toggleGroup}
          selectedPhotos={selectedPhotos}
          selectionMode={selectionMode}
          onPhotoClick={onPhotoClick}
          onToggleSelection={onToggleSelection}
          uploadStatus={uploadStatus}
        />
      </div>

      <SelectionToolbar
        selectionMode={selectionMode}
        selectedPhotos={selectedPhotos}
        onAddToAlbum={() => setShowAddToAlbum(true)}
        onTagAssign={() => setShowTagAssign(true)}
        onDelete={onDeleteSelected}
        onCancel={clearSelection}
        onEnterSelectionMode={() => setSelectionMode(true)}
      />

      <PhotoModal
        photo={selectedPhoto}
        photos={flatVisiblePhotos}
        onClose={() => setSelectedPhoto(null)}
        onSelectPhoto={setSelectedPhoto}
        onToggleFavorite={onToggleFavorite}
        onArchive={onModalArchive}
        onDelete={onModalDelete}
        onReveal={onModalReveal}
        onAddToAlbum={() => { /* TODO(phase-A): wire single-photo add-to-album from modal */ }}
        onTagAssign={() => { /* TODO(phase-A): wire single-photo tag-assign from modal */ }}
      />
      <CreateAlbumModal
        isOpen={showCreateAlbum}
        onClose={() => setShowCreateAlbum(false)}
        onCreate={handleCreateAlbum}
      />
      <AddToAlbumModal
        isOpen={showAddToAlbum}
        onClose={() => setShowAddToAlbum(false)}
        albums={albums}
        onSelect={onAddToAlbum}
      />

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

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        libraryPath={libraryPath}
        onLibraryPathChange={setLibraryPath}
        onPhotosChanged={loadPhotosFromDatabase}
      />

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
          clearSelection();
        }}
      />

      <TerraFormReview
        isOpen={showTerraForm}
        onClose={() => {
          setShowTerraForm(false);
          loadPhotosFromDatabase();
          invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
        }}
      />

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

const App = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <AppProvider>
        <ViewProvider>
          <AppLayout />
        </ViewProvider>
      </AppProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
