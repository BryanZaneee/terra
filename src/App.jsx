import { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, MonitorSmartphone } from 'lucide-react';

import { filterForViewMode } from './utils/viewFilter';
import ErrorBoundary from './components/ErrorBoundary';
import DitherBackground from './components/DitherBackground';
import Sidebar from './components/Sidebar';
import PhotoGrid from './components/PhotoGrid';
import SelectionToolbar from './components/SelectionToolbar';

// Lazy: only load when the user actually opens these.
const PhotoModal = lazy(() => import('./components/PhotoModal'));
const CreateAlbumModal = lazy(() => import('./components/CreateAlbumModal'));
const AddToAlbumModal = lazy(() => import('./components/AddToAlbumModal'));
const ScanModal = lazy(() => import('./components/ScanModal'));
const DuplicateReviewGallery = lazy(() => import('./components/DuplicateReviewGallery'));
const ScreenshotReviewGallery = lazy(() => import('./components/ScreenshotReviewGallery'));
const ArchiveView = lazy(() => import('./components/ArchiveView'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const TagCreateModal = lazy(() =>
  import('./components/TagManager').then((m) => ({ default: m.TagCreateModal }))
);
const TagAssignPopover = lazy(() =>
  import('./components/TagManager').then((m) => ({ default: m.TagAssignPopover }))
);
const StorageAnalytics = lazy(() => import('./components/StorageAnalytics'));
const TerraFormReview = lazy(() => import('./components/TerraFormReview'));
const ImportWizard = lazy(() => import('./components/ImportWizard'));

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
    loadAlbums, loadNextPage,
    counts, refreshCounts,
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
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importProviderId, setImportProviderId] = useState('google_photos');

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

  const openImportWizard = useCallback((providerId = 'google_photos') => {
    setImportProviderId(providerId);
    setShowImportWizard(true);
  }, []);

  const onImportComplete = useCallback(async (summary) => {
    await loadPhotosFromDatabase();
    loadAlbums();
    loadLocations();
    setStatusWithTimeout(
      `Imported ${summary.imported} item${summary.imported === 1 ? '' : 's'} from ${summary.provider_label}`
    );
  }, [loadPhotosFromDatabase, loadAlbums, loadLocations, setStatusWithTimeout]);

  return (
    <div className="min-h-screen text-gray-100 font-sans selection:bg-white/20 selection:text-white">
      <DitherBackground />

      <Sidebar
        photos={photos}
        counts={counts}
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
        onOpenImport={openImportWizard}
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
          // Infinite scroll fires only on views that resolve to a
          // server-side filter — multi-tag, duplicates, and an empty search
          // return null and stay silent.
          onEndReached={
            filterForViewMode(viewMode, { selectedTagIds, searchQuery }) != null
              ? loadNextPage
              : undefined
          }
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

      <Suspense fallback={null}>
        {selectedPhoto && (
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
        )}

        {showCreateAlbum && (
          <CreateAlbumModal
            isOpen={showCreateAlbum}
            onClose={() => setShowCreateAlbum(false)}
            onCreate={handleCreateAlbum}
          />
        )}

        {showAddToAlbum && (
          <AddToAlbumModal
            isOpen={showAddToAlbum}
            onClose={() => setShowAddToAlbum(false)}
            albums={albums}
            onSelect={onAddToAlbum}
          />
        )}

        {showDuplicateScan && (
          <ScanModal
            isOpen={showDuplicateScan}
            onClose={handleDuplicateScanComplete}
            title="Scanning for Duplicates"
            progress={scanProgress}
            phase={scanPhase}
            icon={Copy}
          />
        )}

        {showScreenshotScan && (
          <ScanModal
            isOpen={showScreenshotScan}
            onClose={handleScreenshotScanComplete}
            title="Scanning for Screenshots"
            progress={scanProgress}
            phase={scanPhase}
            icon={MonitorSmartphone}
          />
        )}

        {showDuplicateReview && (
          <DuplicateReviewGallery
            isOpen={showDuplicateReview}
            onClose={() => setShowDuplicateReview(false)}
            duplicateGroups={duplicateGroups}
            onArchive={handleArchivePhotos}
            onRefresh={refreshDuplicateGroups}
          />
        )}

        {showScreenshotReview && (
          <ScreenshotReviewGallery
            isOpen={showScreenshotReview}
            onClose={() => setShowScreenshotReview(false)}
            screenshots={screenshots}
            onArchive={handleArchivePhotos}
            onRefresh={refreshScreenshots}
          />
        )}

        {showArchive && (
          <ArchiveView
            isOpen={showArchive}
            onClose={() => setShowArchive(false)}
            archivedPhotos={archivedPhotos}
            onRestore={handleRestorePhotos}
            onRefresh={loadArchivedPhotos}
          />
        )}

        {showSettings && (
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            libraryPath={libraryPath}
            onLibraryPathChange={setLibraryPath}
            onPhotosChanged={loadPhotosFromDatabase}
          />
        )}

        {showTagCreate && (
          <TagCreateModal
            isOpen={showTagCreate}
            onClose={() => { setShowTagCreate(false); setEditTag(null); }}
            onSave={loadTags}
            editTag={editTag}
          />
        )}

        {showTagAssign && (
          <TagAssignPopover
            isOpen={showTagAssign}
            onClose={() => setShowTagAssign(false)}
            photoPaths={Array.from(selectedPhotos)}
            onTagsChanged={() => {
              loadTags();
              clearSelection();
            }}
          />
        )}

        {showTerraForm && (
          <TerraFormReview
            isOpen={showTerraForm}
            onClose={() => {
              setShowTerraForm(false);
              loadPhotosFromDatabase();
              invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
              refreshCounts();
            }}
          />
        )}

        {showStorageAnalytics && (
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
        )}

        {showImportWizard && (
          <ImportWizard
            isOpen={showImportWizard}
            initialProviderId={importProviderId}
            onClose={() => setShowImportWizard(false)}
            onImportComplete={onImportComplete}
          />
        )}
      </Suspense>
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
