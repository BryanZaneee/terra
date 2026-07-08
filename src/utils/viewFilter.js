/**
 * View-mode → backend `ViewFilter` mapping (PAGINATION_PLAN.md).
 */
const ALL_FILTER = { kind: 'all' };

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
      if (selectedTagIds.length === 0) return null;
      return { kind: 'tags', ids: [...selectedTagIds], match_all: false };
    }
    default: {
      if (viewMode.startsWith('album:')) {
        const id = parseInt(viewMode.slice(6), 10);
        return Number.isNaN(id) ? null : { kind: 'album', id };
      }
      if (viewMode.startsWith('collection:')) {
        return { kind: 'smart_collection', id: viewMode.slice(11) };
      }
      if (viewMode.startsWith('location:')) {
        const name = decodeURIComponent(viewMode.slice(9));
        return name ? { kind: 'location', name } : null;
      }
      return null;
    }
  }
}

/** Stable string key for change-detection and query dedup. */
export function filterKey(filter) {
  if (!filter) return null;
  switch (filter.kind) {
    case 'all': return 'all';
    case 'favorites': return 'favorites';
    case 'photos_only': return 'photos_only';
    case 'videos_only': return 'videos_only';
    case 'archived': return 'archived';
    case 'unreviewed': return 'unreviewed';
    case 'tags': {
      const sorted = [...filter.ids].sort((a, b) => a - b);
      return `tags:${sorted.join(',')}:${filter.match_all ? 'and' : 'or'}`;
    }
    case 'album': return `album:${filter.id}`;
    case 'location': return `location:${filter.name}`;
    case 'search': return `search:${filter.query}`;
    case 'smart_collection': return `collection:${filter.id}`;
    default: return JSON.stringify(filter);
  }
}
