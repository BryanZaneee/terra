/**
 * Group photos for display based on the active view mode.
 *
 * Returns an array of [groupKey, photos[]] tuples in display order.
 *
 * @param {string} viewMode
 * @param {Array} photos - loaded photos for this view (server-filtered when paginated)
 * @param {Array} smartCollections
 * @param {{ serverLocations?: Array<[string, number]> }} options
 */
export function groupPhotosBy(viewMode, photos, smartCollections = [], options = {}) {
  const { serverLocations = [] } = options;

  if (viewMode === 'locations') {
    const byLocation = {};
    photos.forEach((photo) => {
      const key = photo.location || 'Unknown Location';
      if (!byLocation[key]) byLocation[key] = [];
      byLocation[key].push(photo);
    });

    if (serverLocations.length > 0) {
      return serverLocations
        .map(([name]) => [name, byLocation[name] ?? []])
        .filter(([, items]) => items.length > 0);
    }

    return Object.entries(byLocation).sort((a, b) => b[1].length - a[1].length);
  }

  if (viewMode.startsWith('location:')) {
    const name = decodeURIComponent(viewMode.slice(9));
    return [[name || 'Location', photos]];
  }

  if (viewMode === 'tags') {
    return [['Tagged Photos', photos]];
  }

  if (viewMode.startsWith('collection:')) {
    const collectionId = viewMode.split(':')[1];
    const collection = smartCollections.find((c) => c.id === collectionId);
    return [[collection ? collection.name : 'Smart Collection', photos]];
  }

  const groups = {};
  photos.forEach((photo) => {
    let key;
    if (viewMode === 'year') {
      key = new Date(photo.date * 1000).getFullYear().toString();
    } else if (viewMode === 'month') {
      key = new Date(photo.date * 1000).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      });
    } else if (viewMode === 'search') {
      key = 'Search Results';
    } else {
      key = 'All Photos';
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(photo);
  });

  return Object.entries(groups);
}

/** Group header counts are library totals only for locations (via hints). */
export function usesPartialGroupCounts(viewMode) {
  return viewMode === 'year' || viewMode === 'month';
}

/** Server-authoritative counts for location group headers. */
export function buildGroupCountHints(viewMode, serverLocations = []) {
  if (viewMode !== 'locations' || serverLocations.length === 0) return null;
  return Object.fromEntries(serverLocations);
}
