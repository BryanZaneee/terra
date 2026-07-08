import { describe, it, expect } from 'vitest';
import { groupPhotosBy, buildGroupCountHints, usesPartialGroupCounts } from './groupPhotos';

const mkPhoto = (overrides = {}) => ({
  path: '/p.jpg',
  date: 1700000000,
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
    const p2023 = mkPhoto({ path: '/a.jpg', date: 1686787200 });
    const p2024 = mkPhoto({ path: '/b.jpg', date: 1718409600 });
    const result = groupPhotosBy('year', [p2023, p2024]);
    const keys = result.map(([k]) => k);
    expect(keys).toContain('2023');
    expect(keys).toContain('2024');
  });

  it('does not re-filter photos-only view (server already filtered)', () => {
    const photo = mkPhoto({ path: '/p.jpg', mediaType: 'photo' });
    const video = mkPhoto({ path: '/v.mp4', mediaType: 'video' });
    const result = groupPhotosBy('photos', [photo, video]);
    expect(result).toEqual([['All Photos', [photo, video]]]);
  });

  it('uses server location list for headers when provided', () => {
    const ny = mkPhoto({ path: '/ny.jpg', location: 'New York' });
    const result = groupPhotosBy('locations', [ny], [], {
      serverLocations: [['New York', 42], ['Paris', 10]],
    });
    expect(result).toEqual([['New York', [ny]]]);
  });

  it("returns one 'Tagged Photos' group for the tags view", () => {
    const photos = [mkPhoto({ path: '/a.jpg' })];
    expect(groupPhotosBy('tags', photos)).toEqual([['Tagged Photos', photos]]);
  });

  it('labels location drill-down views', () => {
    const photos = [mkPhoto({ path: '/a.jpg', location: 'Paris' })];
    const result = groupPhotosBy('location:Paris', photos);
    expect(result).toEqual([['Paris', photos]]);
  });
});

describe('group count hints', () => {
  it('builds server counts for locations view', () => {
    expect(buildGroupCountHints('locations', [['NY', 5]])).toEqual({ NY: 5 });
    expect(buildGroupCountHints('all', [['NY', 5]])).toBeNull();
  });

  it('flags year/month as partial counts', () => {
    expect(usesPartialGroupCounts('year')).toBe(true);
    expect(usesPartialGroupCounts('all')).toBe(false);
  });
});
