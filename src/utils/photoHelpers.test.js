import { describe, it, expect, vi } from 'vitest';
import { processPhotos, formatBytes, getThumbnailUrl, THUMB_SIZE } from './photoHelpers';

// convertFileSrc is mocked in test/setup.js

describe('processPhotos', () => {
  it('maps raw backend fields to frontend format', () => {
    const raw = [{
      path: '/pics/photo.jpg',
      name: 'photo.jpg',
      date_taken: 1700000000,
      width: 1920,
      height: 1080,
      is_favorite: true,
      content_hash: 'abc123',
      location_name: 'New York, NY',
    }];

    const result = processPhotos(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: '/pics/photo.jpg',
      date: 1700000000,
      name: 'photo.jpg',
      width: 1920,
      height: 1080,
      path: '/pics/photo.jpg',
      is_favorite: true,
      mediaType: 'photo',
      location: 'New York, NY',
      hash: 'abc123',
    });
    expect(result[0].url).toContain('asset://');
  });

  it('detects video media type from extension', () => {
    const extensions = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
    for (const ext of extensions) {
      const raw = [{
        path: `/vid/clip.${ext}`,
        name: `clip.${ext}`,
        date_taken: 1700000000,
        width: 0,
        height: 0,
        is_favorite: false,
        content_hash: null,
        location_name: null,
      }];
      const result = processPhotos(raw);
      expect(result[0].mediaType).toBe('video');
    }
  });

  it('detects video with uppercase extension', () => {
    const raw = [{
      path: '/vid/clip.MOV',
      name: 'clip.MOV',
      date_taken: 1700000000,
      width: 0,
      height: 0,
      is_favorite: false,
      content_hash: null,
      location_name: null,
    }];
    const result = processPhotos(raw);
    expect(result[0].mediaType).toBe('video');
  });

  it('returns photo for non-video extensions', () => {
    const raw = [{
      path: '/pic/img.jpg',
      name: 'img.jpg',
      date_taken: 1700000000,
      width: 100,
      height: 100,
      is_favorite: false,
      content_hash: null,
      location_name: null,
    }];
    const result = processPhotos(raw);
    expect(result[0].mediaType).toBe('photo');
  });

  it('returns empty array for empty input', () => {
    expect(processPhotos([])).toEqual([]);
  });
});

describe('getThumbnailUrl', () => {
  const root = '/Users/x/Library/Application Support/terra/thumbs';

  it('returns the original url when no cache root is provided', () => {
    const photo = { url: 'asset://orig', content_hash: 'abc123', thumb_status: 'ready' };
    expect(getThumbnailUrl(photo, null)).toBe('asset://orig');
    expect(getThumbnailUrl(photo, undefined)).toBe('asset://orig');
  });

  it('returns the original url when thumb is not ready', () => {
    const photo = { url: 'asset://orig', content_hash: 'abc123', thumb_status: 'failed' };
    expect(getThumbnailUrl(photo, root)).toBe('asset://orig');
  });

  it('returns the original url when content_hash is missing', () => {
    const photo = { url: 'asset://orig', content_hash: null, thumb_status: 'ready' };
    expect(getThumbnailUrl(photo, root)).toBe('asset://orig');
  });

  it('builds the cached thumb path when ready and content-addressed', () => {
    const photo = { url: 'asset://orig', content_hash: 'abc123def', thumb_status: 'ready' };
    const result = getThumbnailUrl(photo, root);
    // convertFileSrc encodes path separators, so decode before asserting structure.
    expect(decodeURIComponent(result)).toContain(`${THUMB_SIZE}/ab/abc123def.jpg`);
    expect(result).toContain('asset://');
  });

  it('handles a single-character hash gracefully', () => {
    const photo = { url: 'asset://orig', content_hash: 'a', thumb_status: 'ready' };
    const result = getThumbnailUrl(photo, root);
    expect(decodeURIComponent(result)).toContain('/a/a.jpg');
  });
});

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('formats terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1 TB');
  });
});
