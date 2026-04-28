import { describe, it, expect } from 'vitest';
import { filterForViewMode, isPaginatedViewMode, filterKey } from './viewFilter';

describe('filterForViewMode', () => {
  it('maps favorites/photos/videos to their server-side filter', () => {
    expect(filterForViewMode('favorites')).toEqual({ kind: 'favorites' });
    expect(filterForViewMode('photos')).toEqual({ kind: 'photos_only' });
    expect(filterForViewMode('videos')).toEqual({ kind: 'videos_only' });
  });

  it('maps presentation views (year/month/locations) to the same All filter', () => {
    // year/month/locations are client-side groupings over the full set, so
    // they reuse the All filter — switching between them should not refetch.
    expect(filterForViewMode('all').kind).toBe('all');
    expect(filterForViewMode('year').kind).toBe('all');
    expect(filterForViewMode('month').kind).toBe('all');
    expect(filterForViewMode('locations').kind).toBe('all');
  });

  it('parses album:id into an Album filter', () => {
    expect(filterForViewMode('album:42')).toEqual({ kind: 'album', id: 42 });
    // garbage id → null so the legacy path handles it.
    expect(filterForViewMode('album:nope')).toBeNull();
  });

  it('parses collection:id into a SmartCollection filter', () => {
    expect(filterForViewMode('collection:size_large')).toEqual({
      kind: 'smart_collection',
      id: 'size_large',
    });
  });

  it('routes single-tag selections through Tag and falls back on multi', () => {
    expect(filterForViewMode('tags', { selectedTagIds: [7] })).toEqual({ kind: 'tag', id: 7 });
    // Multi-tag uses AND/OR semantics that don't fit the cursor design yet.
    expect(filterForViewMode('tags', { selectedTagIds: [7, 9] })).toBeNull();
    // No tags selected → no filter.
    expect(filterForViewMode('tags', { selectedTagIds: [] })).toBeNull();
  });

  it('routes search only when a non-empty query is provided', () => {
    expect(filterForViewMode('search', { searchQuery: 'paris' })).toEqual({
      kind: 'search',
      query: 'paris',
    });
    expect(filterForViewMode('search', { searchQuery: '   ' })).toBeNull();
    expect(filterForViewMode('search')).toBeNull();
  });

  it('returns null for unmigrated/unknown views', () => {
    expect(filterForViewMode('duplicates')).toBeNull();
    expect(filterForViewMode('unknown_view_mode')).toBeNull();
  });
});

describe('isPaginatedViewMode', () => {
  it('returns true for built-in and dynamic paginated viewModes', () => {
    expect(isPaginatedViewMode('all')).toBe(true);
    expect(isPaginatedViewMode('favorites')).toBe(true);
    expect(isPaginatedViewMode('search')).toBe(true);
    expect(isPaginatedViewMode('album:1')).toBe(true);
    expect(isPaginatedViewMode('collection:size_large')).toBe(true);
  });

  it('returns false for tags (selection-dependent) and unknowns', () => {
    expect(isPaginatedViewMode('tags')).toBe(false);
    expect(isPaginatedViewMode('duplicates')).toBe(false);
  });
});

describe('filterKey', () => {
  it('produces the same key for equal filters and different keys for different filters', () => {
    expect(filterKey({ kind: 'all' })).toBe(filterKey({ kind: 'all' }));
    expect(filterKey({ kind: 'album', id: 1 })).not.toBe(filterKey({ kind: 'album', id: 2 }));
    expect(filterKey(null)).toBeNull();
  });
});
