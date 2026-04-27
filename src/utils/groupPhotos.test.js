import { describe, it, expect } from 'vitest';
import { groupPhotosBy } from './groupPhotos';

const mkPhoto = (overrides = {}) => ({
  path: '/p.jpg',
  date: 1700000000, // 2023-11-14 UTC
  mediaType: 'photo',
  is_favorite: false,
  ...overrides,
});

describe('groupPhotosBy', () => {
  it("groups by 'all' into a single 'All Photos' section", () => {
    const photos = [mkPhoto({ path: '/a.jpg' }), mkPhoto({ path: '/b.jpg' })];
    const result = groupPhotosBy('all', photos);
    expect(result).toEqual([['All Photos', photos]]);
  });

  it("groups by year using each photo's date", () => {
    // Use mid-year timestamps so timezone offset can't push the date over a year boundary
    const p2023 = mkPhoto({ path: '/a.jpg', date: 1686787200 }); // 2023-06-15 UTC
    const p2024 = mkPhoto({ path: '/b.jpg', date: 1718409600 }); // 2024-06-15 UTC
    const result = groupPhotosBy('year', [p2023, p2024]);
    const keys = result.map(([k]) => k);
    expect(keys).toContain('2023');
    expect(keys).toContain('2024');
  });

  it("filters non-photos out of 'photos' view", () => {
    const photo = mkPhoto({ path: '/p.jpg', mediaType: 'photo' });
    const video = mkPhoto({ path: '/v.mp4', mediaType: 'video' });
    const result = groupPhotosBy('photos', [photo, video]);
    expect(result).toEqual([['All Photos', [photo]]]);
  });

  it("filters non-videos out of 'videos' view", () => {
    const photo = mkPhoto({ path: '/p.jpg', mediaType: 'photo' });
    const video = mkPhoto({ path: '/v.mp4', mediaType: 'video' });
    const result = groupPhotosBy('videos', [photo, video]);
    expect(result).toEqual([['All Photos', [video]]]);
  });

  it("only keeps favorites in 'favorites' view", () => {
    const fav = mkPhoto({ path: '/f.jpg', is_favorite: true });
    const other = mkPhoto({ path: '/o.jpg', is_favorite: false });
    const result = groupPhotosBy('favorites', [fav, other]);
    expect(result).toEqual([['All Photos', [fav]]]);
  });

  it("groups by location, sorts groups by photo count desc", () => {
    const sf = mkPhoto({ path: '/sf.jpg', location: 'San Francisco' });
    const ny1 = mkPhoto({ path: '/ny1.jpg', location: 'New York' });
    const ny2 = mkPhoto({ path: '/ny2.jpg', location: 'New York' });
    const result = groupPhotosBy('locations', [sf, ny1, ny2]);
    expect(result[0][0]).toBe('New York');
    expect(result[0][1]).toHaveLength(2);
    expect(result[1][0]).toBe('San Francisco');
  });

  it("buckets photos without a location under 'Unknown Location'", () => {
    const noLoc = mkPhoto({ path: '/n.jpg' });
    const result = groupPhotosBy('locations', [noLoc]);
    expect(result).toEqual([['Unknown Location', [noLoc]]]);
  });

  it("groups duplicates by their hash prefix, skipping photos without a hash", () => {
    const a = mkPhoto({ path: '/a.jpg', hash: 'abcdef0123' });
    const b = mkPhoto({ path: '/b.jpg', hash: 'abcdef0199' });
    const noHash = mkPhoto({ path: '/c.jpg' });
    const result = groupPhotosBy('duplicates', [a, b, noHash]);
    expect(result).toEqual([['Duplicate Group: abcdef01', [a, b]]]);
  });

  it("returns one 'Tagged Photos' group for the tags view", () => {
    const photos = [mkPhoto({ path: '/a.jpg' })];
    const result = groupPhotosBy('tags', photos);
    expect(result).toEqual([['Tagged Photos', photos]]);
  });

  it("looks up collection name by id for collection: views", () => {
    const photos = [mkPhoto({ path: '/a.jpg' })];
    const collections = [{ id: 'large', name: 'Large (>5MB)' }];
    const result = groupPhotosBy('collection:large', photos, collections);
    expect(result).toEqual([['Large (>5MB)', photos]]);
  });

  it("falls back to 'Smart Collection' when the id is unknown", () => {
    const photos = [mkPhoto({ path: '/a.jpg' })];
    const result = groupPhotosBy('collection:missing', photos, []);
    expect(result).toEqual([['Smart Collection', photos]]);
  });

  it("labels the 'search' view with 'Search Results'", () => {
    const photos = [mkPhoto({ path: '/a.jpg' })];
    const result = groupPhotosBy('search', photos);
    expect(result).toEqual([['Search Results', photos]]);
  });
});
