import { createContext, useContext, useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { processPhotos } from '../utils/photoHelpers';
import { useAppContext } from './AppContext';

const ViewContext = createContext(null);

export function ViewProvider({ children }) {
  const {
    photos, setPhotos, setLoading, loadPhotosFromDatabase,
    selectedTagIds, setSelectedTagIds,
    tags, loadTags,
  } = useAppContext();

  const [viewMode, setViewMode] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState([]);
  const [smartCollections, setSmartCollections] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  const searchDebounceRef = useRef(null);
  const wasFilteredViewRef = useRef(false);
  const prevGroupKeysRef = useRef('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    loadLocations();
    loadSmartCollections();
    invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
    return () => {
      isMountedRef.current = false;
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLocations = async () => {
    try {
      const result = await invoke('get_locations');
      setLocations(result);
    } catch (err) {
      console.error("Failed to load locations:", err);
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

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!query.trim()) {
      loadPhotosFromDatabase();
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      setLoading(true);
      try {
        const result = await invoke('search_photos', { query });
        if (!isMountedRef.current) return;
        setPhotos(processPhotos(result));
        setViewMode('search');
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    }, 300);
  };

  // Group photos
  const groupedPhotos = useMemo(() => {
    const groups = {};

    if (viewMode === 'duplicates') {
      photos.forEach(photo => {
        if (!photo.hash) return;
        const key = `Duplicate Group: ${photo.hash.substring(0, 8)}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(photo);
      });
      return Object.entries(groups);
    }

    if (viewMode === 'locations') {
      photos.forEach(photo => {
        const key = photo.location || 'Unknown Location';
        if (!groups[key]) groups[key] = [];
        groups[key].push(photo);
      });
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

      if (viewMode === 'photos' && photo.mediaType !== 'photo') return;
      if (viewMode === 'videos' && photo.mediaType !== 'video') return;
      if (viewMode === 'favorites' && !photo.is_favorite) return;

      if (!groups[key]) groups[key] = [];
      groups[key].push(photo);
    });
    return Object.entries(groups);
  }, [photos, viewMode, smartCollections]);

  const flatVisiblePhotos = useMemo(() => {
    return groupedPhotos.flatMap(([_, items]) => items);
  }, [groupedPhotos]);

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
      wasFilteredViewRef.current = true;
    } else if (wasFilteredViewRef.current && isRegularView) {
      wasFilteredViewRef.current = false;
      loadPhotosFromDatabase();
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-expand new groups
  useEffect(() => {
    const currentKeys = groupedPhotos.map(([key]) => key).join('|');
    if (currentKeys !== prevGroupKeysRef.current) {
      prevGroupKeysRef.current = currentKeys;
      const initial = {};
      groupedPhotos.forEach(([key]) => {
        initial[key] = expandedGroups[key] !== undefined ? expandedGroups[key] : true;
      });
      setExpandedGroups(initial);
    }
  }, [groupedPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    viewMode,
    setViewMode,
    searchQuery,
    handleSearch,
    locations,
    loadLocations,
    smartCollections,
    loadSmartCollections,
    groupedPhotos,
    flatVisiblePhotos,
    expandedGroups,
    toggleGroup,
    unreviewedCount,
    setUnreviewedCount,
  };

  return (
    <ViewContext.Provider value={value}>
      {children}
    </ViewContext.Provider>
  );
}

export function useViewContext() {
  const context = useContext(ViewContext);
  if (!context) throw new Error('useViewContext must be used within ViewProvider');
  return context;
}
