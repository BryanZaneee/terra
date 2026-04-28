/**
 * View-mode → backend `ViewFilter` mapping (PAGINATION_PLAN.md).
 *
 * Returns `null` for views that aren't on the paginated path (multi-tag
 * selections, the duplicates scan, an empty search query) — those still
 * bypass `get_photos_page` and fetch in one shot.
 */
const ALL_FILTER = { kind: 'all' };

const STATIC_PAGINATED = new Set([
  'all', 'year', 'month', 'locations',
  'favorites', 'photos', 'videos', 'search',
]);

export function filterForViewMode(viewMode, ctx = {}) {
  const { selectedTagIds = [], searchQuery = '' } = ctx;

  switch (viewMode) {
    case 'favorites': return { kind: 'favorites' };
    case 'photos':    return { kind: 'photos_only' };
    case 'videos':    return { kind: 'videos_only' };
    case 'all':
    case 'year':
    case 'month':
    case 'locations':
      return ALL_FILTER;
    case 'search': {
      const q = (searchQuery || '').trim();
      return q ? { kind: 'search', query: q } : null;
    }
    case 'tags': {
      // Single-tag paginates; multi-tag falls back to the legacy
      // get_photos_by_tags call (AND/OR semantics need a different cursor).
      if (selectedTagIds.length === 1) return { kind: 'tag', id: selectedTagIds[0] };
      return null;
    }
    default: {
      if (viewMode.startsWith('album:')) {
        const id = parseInt(viewMode.slice(6), 10);
        return Number.isNaN(id) ? null : { kind: 'album', id };
      }
      if (viewMode.startsWith('collection:')) {
        return { kind: 'smart_collection', id: viewMode.slice(11) };
      }
      // duplicates and any other unknown viewMode stays on the legacy path.
      return null;
    }
  }
}

export function isPaginatedViewMode(viewMode) {
  if (STATIC_PAGINATED.has(viewMode)) return true;
  if (viewMode.startsWith('album:')) return true;
  if (viewMode.startsWith('collection:')) return true;
  // 'tags' depends on selection size — caller checks via filterForViewMode.
  return false;
}

/** Stable key for change-detection. JSON.stringify on a fixed shape is fine. */
export function filterKey(filter) {
  return filter ? JSON.stringify(filter) : null;
}
