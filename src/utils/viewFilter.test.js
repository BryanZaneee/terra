import { describe, it, expect } from 'vitest';
import { filterForViewMode, filterKey } from './viewFilter';
import { resolveViewQuery, supportsPaginatedScroll } from './viewQuery';

describe('filterForViewMode', () => {
  it('maps favorites/photos/videos to their server-side filter', () => {
    expect(filterForViewMode('favorites')).toEqual({ kind: 'favorites' });
    expect(filterForViewMode('photos')).toEqual({ kind: 'photos_only' });
    expect(filterForViewMode('videos')).toEqual({ kind: 'videos_only' });
  });

  it('maps presentation views to the All filter', () => {
    expect(filterForViewMode('all').kind).toBe('all');
    expect(filterForViewMode('year').kind).toBe('all');
    expect(filterForViewMode('month').kind).toBe('all');
    expect(filterForViewMode('locations').kind).toBe('all');
  });

  it('maps tag selections to paginated Tags filter (single and multi)', () => {
    expect(filterForViewMode('tags', { selectedTagIds: [7] })).toEqual({
      kind: 'tags',
      ids: [7],
      match_all: false,
    });
    expect(filterForViewMode('tags', { selectedTagIds: [7, 9] })).toEqual({
      kind: 'tags',
      ids: [7, 9],
      match_all: false,
    });
    expect(filterForViewMode('tags', { selectedTagIds: [] })).toBeNull();
  });

  it('parses album, collection, and location drill-down modes', () => {
    expect(filterForViewMode('album:42')).toEqual({ kind: 'album', id: 42 });
    expect(filterForViewMode('collection:size_large')).toEqual({
      kind: 'smart_collection',
      id: 'size_large',
    });
    expect(filterForViewMode('location:Paris')).toEqual({ kind: 'location', name: 'Paris' });
  });
});

describe('filterKey', () => {
  it('uses deterministic string keys', () => {
    expect(filterKey({ kind: 'all' })).toBe('all');
    expect(filterKey({ kind: 'tags', ids: [2, 1], match_all: false })).toBe('tags:1,2:or');
    expect(filterKey({ kind: 'search', query: 'paris' })).toBe('search:paris');
    expect(filterKey(null)).toBeNull();
  });
});

describe('resolveViewQuery', () => {
  it('returns paginated strategy for album and multi-tag views', () => {
    expect(resolveViewQuery('album:1')).toMatchObject({
      strategy: 'paginated',
      queryKey: 'album:1',
    });
    expect(resolveViewQuery('tags', { selectedTagIds: [2, 5] })).toMatchObject({
      strategy: 'paginated',
      queryKey: 'tags:2,5:or',
    });
  });

  it('skips search view (owned by debounced handler)', () => {
    expect(resolveViewQuery('search', { searchQuery: 'x' }).strategy).toBe('skip');
  });
});

describe('supportsPaginatedScroll', () => {
  it('is true for all paginated views including multi-tag', () => {
    expect(supportsPaginatedScroll('favorites')).toBe(true);
    expect(supportsPaginatedScroll('tags', { selectedTagIds: [1, 2] })).toBe(true);
  });
});
