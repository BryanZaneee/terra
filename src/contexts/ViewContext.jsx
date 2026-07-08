import { createContext, useCallback, useContext, useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { groupPhotosBy, buildGroupCountHints, usesPartialGroupCounts } from '../utils/groupPhotos';
import { CONFIG } from '../config';
import { useAppContext } from './AppContext';
import { useViewPhotoLoader } from '../hooks/useViewPhotoLoader';
import { useAsyncGuard } from '../hooks/useAsyncGuard';

const ViewContext = createContext(null);

const REGULAR_VIEWS = ['all', 'year', 'month', 'photos', 'videos', 'favorites', 'locations'];

export function ViewProvider({ children }) {
  const {
    photos, setPhotos, setLoading, loadPhotosFromDatabase,
    selectedTagIds, setSelectedTagIds, counts,
  } = useAppContext();

  const [viewMode, setViewMode] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState([]);
  const [smartCollectionMeta, setSmartCollectionMeta] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  const searchDebounceRef = useRef(null);
  const prevGroupKeysRef = useRef('');
  const activeRef = useAsyncGuard();

  const { loadSearch, invalidateQueryKey } = useViewPhotoLoader({
    viewMode,
    selectedTagIds,
    searchQuery,
    loadPhotosFromDatabase,
  });

  useEffect(() => {
    loadLocations();
    loadSmartCollections();
    invoke('get_unreviewed_count').then(setUnreviewedCount).catch(console.error);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await invoke('get_locations'));
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  }, []);

  const loadSmartCollections = useCallback(async () => {
    try {
      setSmartCollectionMeta(await invoke('get_smart_collections'));
    } catch (err) {
      console.error('Failed to load smart collections:', err);
    }
  }, []);

  // Static metadata from the backend + live counts from the view-count cache.
  const smartCollections = useMemo(
    () => smartCollectionMeta.map((c) => ({
      ...c,
      count: counts?.by_smart_collection?.[c.id] ?? 0,
    })),
    [smartCollectionMeta, counts],
  );

  const handleSearch = useCallback((query) => {
    setSearchQuery(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!query.trim()) {
      invalidateQueryKey();
      setViewMode('all');
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      if (!activeRef.current) return;
      setViewMode('search');
      await loadSearch(query.trim());
    }, CONFIG.SEARCH_DEBOUNCE_MS);
  }, [invalidateQueryKey, loadSearch, activeRef]);

  const groupedPhotos = useMemo(
    () => groupPhotosBy(viewMode, photos, smartCollections, { serverLocations: locations }),
    [photos, viewMode, smartCollections, locations],
  );

  const groupCountHints = useMemo(
    () => buildGroupCountHints(viewMode, locations),
    [viewMode, locations],
  );

  const partialGroupCounts = usesPartialGroupCounts(viewMode);

  const flatVisiblePhotos = useMemo(
    () => groupedPhotos.flatMap(([, items]) => items),
    [groupedPhotos],
  );

  const toggleGroup = useCallback((groupKey) => {
    if (viewMode === 'locations' && groupKey) {
      setViewMode(`location:${encodeURIComponent(groupKey)}`);
      invalidateQueryKey();
      return;
    }
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, [viewMode, invalidateQueryKey]);

  const cycleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const idx = REGULAR_VIEWS.indexOf(prev);
      return idx === -1 ? REGULAR_VIEWS[0] : REGULAR_VIEWS[(idx + 1) % REGULAR_VIEWS.length];
    });
  }, []);

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
  }, [groupedPhotos]);

  const value = useMemo(() => ({
    viewMode,
    setViewMode,
    cycleViewMode,
    searchQuery,
    handleSearch,
    loadLocations,
    smartCollections,
    groupedPhotos,
    groupCountHints,
    partialGroupCounts,
    flatVisiblePhotos,
    expandedGroups,
    toggleGroup,
    unreviewedCount,
    setUnreviewedCount,
  }), [
    viewMode, cycleViewMode, searchQuery, handleSearch, loadLocations,
    smartCollections, groupedPhotos, groupCountHints, partialGroupCounts,
    flatVisiblePhotos, expandedGroups, toggleGroup, unreviewedCount,
  ]);

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
