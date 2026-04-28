import { convertFileSrc } from '@tauri-apps/api/core';

// Must match THUMB_SIZE in src-tauri/src/thumbnails.rs.
export const THUMB_SIZE = 256;

/**
 * Resolve the asset URL to use for a photo's gallery card.
 * Returns the cached 256² thumbnail when ready, else falls back to the
 * original. Pure function — no side effects, no IO.
 */
export function getThumbnailUrl(photo, thumbCacheRoot) {
  if (!thumbCacheRoot) return photo.url;
  if (photo.thumb_status !== 'ready') return photo.url;
  const hash = photo.content_hash;
  if (!hash) return photo.url;
  const prefix = hash.length >= 2 ? hash.slice(0, 2) : hash;
  return convertFileSrc(`${thumbCacheRoot}/${THUMB_SIZE}/${prefix}/${hash}.jpg`);
}

/**
 * Process raw photo metadata from the Rust backend into the format used by the React frontend.
 */
export function processPhotos(rawPhotos) {
  return rawPhotos.map(p => ({
    ...p,
    id: p.path,
    url: convertFileSrc(p.path),
    date: p.date_taken,
    mediaType: p.name.match(/\.(mp4|mov|avi|webm|mkv)$/i) ? 'video' : 'photo',
    location: p.location_name,
    hash: p.content_hash,
  }));
}

/**
 * Format bytes into a human-readable string (e.g. "1.5 GB").
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
