/** Video extensions — keep in sync with IS_VIDEO_SQL in src-tauri/src/db/pagination.rs */
const VIDEO_EXT = /\.(mp4|mov|avi|webm|mkv)$/i;

export function isVideoFilename(name) {
  return VIDEO_EXT.test(name ?? '');
}

export function mediaKindFromFilename(name) {
  return isVideoFilename(name) ? 'video' : 'photo';
}
