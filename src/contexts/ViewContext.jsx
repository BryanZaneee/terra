import { createContext, useContext, useState, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { processPhotos } from '../utils/photoHelpers';
import { groupPhotosBy } from '../utils/groupPhotos';
import { filterForViewMode, filterKey } from '../utils/viewFilter';
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
  const prevGroupKeysRef = useRef('');
  const isMountedRef = useRef(true);
  // Stable key of the last server-side filter we requested. Pure-presentation
  // switches (all → year → month → locations) all map to the same key and
  // skip the round-trip; album:5 → album:6 changes the key and reloads.
  const lastFilterKeyRef = useRef(filterKey({ kind: 'all' }));


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
      // Empty query → drop back to All; the effect below detects the filter
      // change and resets the cursor walk.
      setViewMode('all');
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      const filter = { kind: 'search', query: query.trim() };
      lastFilterKeyRef.current = filterKey(filter);
      setViewMode('search');
      await loadPhotosFromDatabase(filter);
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

  // Load photos for the current view. Most views resolve to a server-side
  // ViewFilter that the paged loader handles; the only exceptions are:
  //  - multi-tag (AND/OR semantics that don't fit the cursor design),
  //  - duplicates and search, which are populated by their own flows
  //    (search via handleSearch above; duplicates via the scan modal).
  useEffect(() => {
    const load = async () => {
      try {
        if (viewMode === 'search' || viewMode === 'duplicates') {
          // Photos here come from handleSearch / the duplicate scan; no
          // load to perform from this effect.
          return;
        }

        const filter = filterForViewMode(viewMode, { selectedTagIds });
        if (filter) {
          const key = filterKey(filter);
          if (key !== lastFilterKeyRef.current) {
            lastFilterKeyRef.current = key;
            await loadPhotosFromDatabase(filter);
          }
          return;
        }

        // No paginated filter resolved → multi-tag is the only such case
        // today. Direct-fetch with AND/OR semantics, then mark the cursor
        // stale so the next paginated view triggers a reload.
        lastFilterKeyRef.current = null;
        if (viewMode === 'tags' && selectedTagIds.length > 0) {
          setLoading(true);
          const result = await invoke('get_photos_by_tags', {
            tagIds: selectedTagIds,
            matchAll: false,
          });
          setPhotos(processPhotos(result));
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
