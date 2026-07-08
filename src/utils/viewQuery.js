import { filterForViewMode, filterKey } from './viewFilter';

/** @typedef {'paginated' | 'skip'} ViewLoadStrategy */

export function resolveViewQuery(viewMode, ctx = {}) {
  const { selectedTagIds = [], searchQuery = '' } = ctx;

  if (viewMode === 'search') {
    return { strategy: 'skip', queryKey: filterKey({ kind: 'search', query: searchQuery.trim() }) };
  }

  const filter = filterForViewMode(viewMode, { selectedTagIds, searchQuery });
  if (filter) {
    return { strategy: 'paginated', queryKey: filterKey(filter), filter };
  }

  return { strategy: 'skip', queryKey: null };
}

export function supportsPaginatedScroll(viewMode, ctx = {}) {
  return resolveViewQuery(viewMode, ctx).strategy === 'paginated';
}
