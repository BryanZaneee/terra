import { describe, it, expect } from 'vitest';
import { filterForViewMode, isPaginatedViewMode, PAGINATED_VIEW_MODES } from './viewFilter';

describe('filterForViewMode', () => {
  it('maps favorites/photos/videos to their server-side filter', () => {
    expect(filterForViewMode('favorites')).toEqual({ kind: 'favorites' });
    expect(filterForViewMode('photos')).toEqual({ kind: 'photos_only' });
    expect(filterForViewMode('videos')).toEqual({ kind: 'videos_only' });
  });

  it('maps presentation views (year/month/locations) to All', () => {
    // year/month/locations are client-side groupings over the full set, so
    // they reuse the All filter — switching between them should not refetch.
    expect(filterForViewMode('all').kind).toBe('all');
    expect(filterForViewMode('year').kind).toBe('all');
    expect(filterForViewMode('month').kind).toBe('all');
    expect(filterForViewMode('locations').kind).toBe('all');
  });

  it('returns null for views not yet on the paginated path', () => {
    expect(filterForViewMode('album:5')).toBeNull();
    expect(filterForViewMode('collection:size_large')).toBeNull();
    expect(filterForViewMode('tags')).toBeNull();
    expect(filterForViewMode('search')).toBeNull();
    expect(filterForViewMode('duplicates')).toBeNull();
  });
});

describe('isPaginatedViewMode', () => {
  it('returns true for built-in views and false for filtered ones', () => {
    PAGINATED_VIEW_MODES.forEach((m) => expect(isPaginatedViewMode(m)).toBe(true));
    expect(isPaginatedViewMode('album:1')).toBe(false);
    expect(isPaginatedViewMode('tags')).toBe(false);
    expect(isPaginatedViewMode('search')).toBe(false);
  });
});
