import { createContext, useContext, useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { processPhotos } from '../utils/photoHelpers';
import { groupPhotosBy } from '../utils/groupPhotos';
import { filterForViewMode } from '../utils/viewFilter';
import { CONFIG } from '../config';
import { useAppContext } from './AppContext';

const ViewContext = createContext(null);

const REGULAR_VIEWS = ['all', 'year', 'month', 'photos', 'videos', 'favorites', 'locations'];

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
  // Tracks the last server-side filter we requested in paginated mode, so
  // pure-presentation switches (all → year → month → locations) skip the
  // round-trip while filter changes (all → favorites) trigger a reload.
  const lastFilterKindRef = useRef('all');

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
      setLocations(await invoke('get_locations'));
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  };

  const loadSmartCollections = async () => {
    try {
      setSmartCollections(await invoke('get_smart_collections'));
    } catch (err) {
      console.error('Failed to load smart collections:', err);
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
        console.error('Search failed:', err);
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    }, 300);
  };

  const groupedPhotos = useMemo(
    () => groupPhotosBy(viewMode, photos, smartCollections),
    [photos, viewMode, smartCollections],
  );

  const flatVisiblePhotos = useMemo(
    () => groupedPhotos.flatMap(([, items]) => items),
    [groupedPhotos],
  );

  // Load photos for the current view. Single effect keyed on viewMode +
  // selectedTagIds replaces what used to be four near-identical effects.
  useEffect(() => {
    const load = async () => {
      try {
        // Paginated path (P.3): for built-in views, derive a server-side
        // ViewFilter and reload only when the filter kind actually changes.
        // Pure regrouping (year/month/locations all map to ::All) is a
        // no-op so users don't pay a round-trip for view-mode switches.
        if (CONFIG.USE_PAGINATION) {
          const filter = filterForViewMode(viewMode);
          if (filter) {
            wasFilteredViewRef.current = false;
            if (filter.kind !== lastFilterKindRef.current) {
              lastFilterKindRef.current = filter.kind;
              await loadPhotosFromDatabase(filter);
            }
            return;
          }
          // Filter is null → an album / tag / search / collection / duplicates
          // view that hasn't been migrated yet. Fall through to the legacy
          // direct-fetch branches below; on return to a paginated view, the
          // filter-kind change will trigger a fresh first page.
          lastFilterKindRef.current = '';
        }

        if (viewMode.startsWith('album:')) {
          wasFilteredViewRef.current = true;
          setLoading(true);
          const albumId = parseInt(viewMode.split(':')[1]);
          const result = await invoke('get_album_photos', { albumId });
          setPhotos(processPhotos(result));
        } else if (viewMode.startsWith('collection:')) {
          wasFilteredViewRef.current = true;
          setLoading(true);
          const collectionId = viewMode.split(':')[1];
          const result = await invoke('get_smart_collection_photos', { collectionId });
          setPhotos(processPhotos(result));
        } else if (viewMode === 'tags') {
          wasFilteredViewRef.current = true;
          if (selectedTagIds.length > 0) {
            setLoading(true);
            const result = await invoke('get_photos_by_tags', {
              tagIds: selectedTagIds,
              matchAll: false,
            });
            setPhotos(processPhotos(result));
          }
        } else if (viewMode === 'duplicates' || viewMode === 'search') {
          // photos for these views are populated by their respective scan/search flows
          wasFilteredViewRef.current = true;
        } else if (REGULAR_VIEWS.includes(viewMode) && wasFilteredViewRef.current) {
          // returning to a normal view from a filtered one — reload everything
          wasFilteredViewRef.current = false;
          await loadPhotosFromDatabase();
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [viewMode, selectedTagIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const cycleViewMode = () => {
    const idx = REGULAR_VIEWS.indexOf(viewMode);
    const next = idx === -1
      ? REGULAR_VIEWS[0]
      : REGULAR_VIEWS[(idx + 1) % REGULAR_VIEWS.length];
    setViewMode(next);
  };

  // Auto-expand new groups whenever the visible group set changes
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
    cycleViewMode,
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
