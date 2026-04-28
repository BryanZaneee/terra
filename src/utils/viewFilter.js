/**
 * View-mode → backend `ViewFilter` mapping (PAGINATION_PLAN.md).
 *
 * Built-in viewModes that ship paginated in P.3:
 *   all / year / month / locations  → server returns the full set; the client
 *                                     just regroups (year/month/location are
 *                                     presentation modes over the same data).
 *   favorites / photos / videos     → server-side filter slice.
 *
 * Returns `null` for views not yet on the paginated path (album, tag, search,
 * smart collection, duplicates) — those still bypass and fetch in one shot
 * until P.4 lifts them onto `get_photos_page`.
 */
const ALL_FILTER = { kind: 'all' };

export const PAGINATED_VIEW_MODES = new Set([
  'all', 'year', 'month', 'locations',
  'favorites', 'photos', 'videos',
]);

export function filterForViewMode(viewMode) {
  switch (viewMode) {
    case 'favorites': return { kind: 'favorites' };
    case 'photos':    return { kind: 'photos_only' };
    case 'videos':    return { kind: 'videos_only' };
    case 'all':
    case 'year':
    case 'month':
    case 'locations':
      return ALL_FILTER;
    default:
      return null;
  }
}

export function isPaginatedViewMode(viewMode) {
  return PAGINATED_VIEW_MODES.has(viewMode);
}
