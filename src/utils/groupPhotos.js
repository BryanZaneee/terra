/**
 * Group photos for display based on the active view mode.
 *
 * Returns an array of [groupKey, photos[]] tuples in display order. The
 * caller treats each tuple as one section (e.g. a year header followed by
 * its photos in a year view).
 *
 * @param {string} viewMode  - one of 'all' | 'year' | 'month' | 'photos' |
 *                             'videos' | 'favorites' | 'locations' | 'search' |
 *                             'tags' | 'duplicates' | 'album:<id>' | 'collection:<id>'
 * @param {Array}  photos    - photos already loaded for this view
 * @param {Array}  smartCollections - smart collection metadata (used to
 *                             label `collection:<id>` views)
 * @returns {Array<[string, Array]>}
 */
export function groupPhotosBy(viewMode, photos, smartCollections = []) {
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
    return [['Tagged Photos', photos]];
  }

  if (viewMode.startsWith('collection:')) {
    const collectionId = viewMode.split(':')[1];
    const collection = smartCollections.find(c => c.id === collectionId);
    return [[collection ? collection.name : 'Smart Collection', photos]];
  }

  photos.forEach(photo => {
    if (viewMode === 'photos' && photo.mediaType !== 'photo') return;
    if (viewMode === 'videos' && photo.mediaType !== 'video') return;
    if (viewMode === 'favorites' && !photo.is_favorite) return;

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
