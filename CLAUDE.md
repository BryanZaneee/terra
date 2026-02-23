# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terra is a high-performance local photo gallery application for macOS built with Tauri v2, React, and Rust. It features a managed photo library system with SQLite caching, EXIF/GPS metadata extraction, duplicate detection, screenshot detection, tagging, smart collections, and a unique glassy UI with animated ASCII dithered background.

## Development Commands

```bash
# Development
npm run tauri:dev       # Start Tauri development server (includes Vite)
npm run dev             # Start Vite dev server only (frontend-only work)

# Production
npm run tauri:build     # Creates macOS .app bundle in src-tauri/target/release/bundle/

# Rust Backend Testing
cd src-tauri
cargo check             # Fast compilation check
cargo test              # Run tests
cargo build             # Build without running
```

**First build takes 2-5 minutes** for Rust compilation. After moving the project directory, run `cd src-tauri && cargo clean` to clear cached build artifacts.

## Architecture

### Three-Layer System

1. **Rust Backend** (`src-tauri/src/`)
   - `lib.rs` - Core photo processing with 40+ Tauri commands organized into sections:
     - Photo management: `upload_photos`, `get_all_photos`, `scan_directory`, `delete_photos`
     - Favorites: `toggle_favorite`
     - Albums: `create_album`, `delete_album`, `get_albums`, `add_to_album`, `remove_from_album`, `get_album_photos`, `set_album_cover`
     - Duplicate detection: `scan_for_duplicates`, `get_duplicate_groups` (uses perceptual dHash)
     - Screenshot detection: `scan_for_screenshots`, `get_screenshots`
     - Archive: `archive_photos`, `restore_photos`, `get_archived_photos`, `cleanup_old_archives` (14-day auto-delete)
     - TerraForm review: `get_unreviewed_photos`, `mark_photo_reviewed`, `get_unreviewed_count`, `unmark_photo_reviewed`
     - Tags: `create_tag`, `update_tag`, `delete_tag`, `get_all_tags`, `get_tags_for_photo`, `add_tags_to_photos`, `remove_tag_from_photo`, `get_photos_by_tags`, `search_tags`
     - Smart Collections: `get_smart_collections`, `get_smart_collection_photos`
     - Storage Analytics: `get_storage_analytics`, `populate_file_sizes`
     - Search: `search_photos`, `get_locations`, `get_duplicates`
   - `db.rs` - SQLite operations with comprehensive schema supporting all features
   - `main.rs` - Desktop entry point (calls `terra_lib::run()`)

2. **React Frontend** (`src/App.jsx`)
   - Single-file component architecture (~2000 lines)
   - Components: `DitherBackground`, `PhotoModal`, `VideoPlayer`, `CreateAlbumModal`, `AddToAlbumModal`, `ScanModal`, `DuplicateReviewGallery`, `ScreenshotReviewGallery`, `ArchiveView`, `ErrorBoundary`
   - Uses Tauri's `invoke()` for backend communication
   - Uses `convertFileSrc()` to convert file paths to `asset://` protocol URLs

3. **SQLite Database** (`~/Library/Application Support/terra/photos.db`)
   - Schema includes: `path, name, date_taken, width, height, source_type, created_at, is_favorite, content_hash, latitude, longitude, location_name, dhash_64, is_screenshot, archived_at, reviewed_at, file_size`
   - Tables: `photos`, `albums`, `album_photos`, `tags`, `photo_tags`
   - Indexes on: `date_taken`, `content_hash`, `location_name`, `dhash_64`, `archived_at`, `reviewed_at`, `file_size`

### File Paths

- **Managed Library**: `~/Pictures/Terra/YYYY/MM/` - Photos organized by date
- **Archive**: `~/Pictures/Terra/Archive/` - Archived photos (14-day retention)
- **Database**: `~/Library/Application Support/terra/photos.db`

### Key Data Flows

**Photo Import**: User selects files → `upload_photos()` copies to library → extracts EXIF/GPS → computes content hash → computes dHash → detects screenshots → saves to DB

**Metadata Extraction Priority**: EXIF DateTimeOriginal → Filename parsing (`YYYY-MM-DD_HHMMSS`) → File modified time → Current timestamp

**Duplicate Detection**: Exact matches via SHA-256 `content_hash`, similar photos via 64-bit perceptual `dhash_64` with Hamming distance threshold (default 10 bits)

**Screenshot Detection**: Filename patterns (`screenshot`, `screen shot`, `capture`, etc.) + device screen dimension matching (iPhone, Android, Mac resolutions)

## Tauri v2 Configuration

`tauri.conf.json` must include asset protocol scope for image display:
```json
"security": {
  "assetProtocol": {
    "enable": true,
    "scope": ["$PICTURE/**", "$DATA/**"]
  }
}
```

## Adding a New Tauri Command

1. Add function to `src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn my_command(param: String) -> Result<String, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    // ... implementation
    Ok(result)
}
```

2. Register in `run()` function's `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    my_command
])
```

3. Call from React:
```javascript
const result = await invoke('my_command', { param: 'value' });
```

## Modifying Database Schema

1. Update schema in `db.rs` → `init_database()` - uses `ALTER TABLE ADD COLUMN` for migrations
2. Update `PhotoMetadata` struct in `lib.rs`
3. Update query mappings in relevant `get_*` functions
4. Add index if needed for performance

## Key Dependencies

### Rust (`src-tauri/Cargo.toml`)
- `tauri = "2"` with `"protocol-asset"` feature
- `rusqlite = "0.32"` with `"bundled"` feature
- `rexif = "0.7"` - EXIF parsing
- `image = "0.25"` - Image dimensions
- `image_hasher = "2.0"` - Perceptual hashing (dHash)
- `reverse_geocoder = "3.0"` - GPS to location names
- `rayon = "1.10"` - Parallel processing
- `sha2 = "0.10"` - Content hashing
- `regex = "1"` - Filename date parsing
- `chrono = "0.4"` - Date/time handling
- `lazy_static = "1.4"` - Cached regex/geocoder

### JavaScript (`package.json`)
- `@tauri-apps/api = "^2.0.0"` - Core Tauri APIs
- `@tauri-apps/plugin-dialog = "^2.0.0"` - File picker
- `react = "^18.2.0"`, `lucide-react`, `recharts`

## Event System

Backend emits progress events for long-running operations:
- `scan_progress` - Duplicate scanning progress
- `screenshot_scan_progress` - Screenshot detection progress
- `file_size_progress` - File size population progress

Listen in frontend:
```javascript
const unlisten = await listen('scan_progress', (event) => {
  // event.payload: { total, processed, phase }
});
```

## Performance Notes

- Uses `rayon` for parallel photo processing (`.par_iter()`)
- Lazy loading with `loading="lazy"` on images
- `lazy_static!` for cached regex patterns and geocoder data
- Database indexes on frequently queried columns
- DitherBackground uses throttled animation (24 FPS) with visibility-based pausing

**Known Limitation**: No virtual scrolling. DOM performance degrades with 50,000+ photos. Future: integrate `react-window`.

## Debugging

1. **Thumbnails not loading**: Check `assetProtocol.scope` in `tauri.conf.json`, verify canonical paths
2. **EXIF date parsing fails**: Check console for "Failed to parse EXIF datetime" - filename parsing should catch it
3. **Build fails after directory move**: Run `cd src-tauri && cargo clean`
4. **Video playback issues**: Check codec support, MOV/MP4 should work natively
