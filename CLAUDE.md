# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terra is a high-performance local photo gallery application for macOS built with Tauri v2, React, and Rust. It features a managed photo library system with SQLite caching, EXIF/GPS metadata extraction, duplicate detection, screenshot detection, tagging, smart collections, cloud provider import, and a unique glassy UI with animated ASCII dithered background.

## Development Commands

```bash
# Development
npm run tauri:dev       # Start Tauri development server (includes Vite)
npm run dev             # Start Vite dev server only (frontend-only work)

# Production
npm run tauri:build     # Creates macOS .app bundle in src-tauri/target/release/bundle/

# Frontend Tests (Vitest)
npm run test:run        # Run all tests once
npm run test            # Watch mode

# Rust Backend
cd src-tauri
cargo check             # Fast compilation check
cargo test              # Run tests
cargo build             # Build without running
```

**First build takes 2-5 minutes** for Rust compilation. After moving the project directory, run `cd src-tauri && cargo clean` to clear cached build artifacts.

## Architecture

### Three-Layer System

1. **Rust Backend** (`src-tauri/src/`)
   - `lib.rs` - Entry point: 40+ Tauri commands, `PhotoMetadata` struct, process-wide DB handle
   - `db/` - SQLite operations split into modules: `photos`, `albums`, `tags`, `archive`, `review`, `scan`, `collections`, `analytics`, `pagination`, `schema`, `row`
   - `imports.rs` - Cloud provider import discovery (iCloud Photos, Google Photos, Snapchat, local export)
   - `media.rs` - dHash computation, screenshot detection, image processing, geocoder
   - `metadata_enrich.rs` - EXIF/GPS metadata extraction
   - `thumbnails.rs` - On-disk JPEG thumbnail cache (content-addressed)
   - `main.rs` - Desktop entry point

2. **React Frontend** (`src/`)
   - `App.jsx` - Root layout wiring; lazy-loads heavy modals
   - `components/` - All UI components, each with a co-located `.test.jsx`
   - `contexts/AppContext.jsx` - Global state: photos, albums, tags, upload, cleanup workflows
   - `contexts/ViewContext.jsx` - View-mode state, search, pagination triggers, smart collections
   - `contexts/ThemeContext.jsx` - Theme management
   - `hooks/usePhotos.js` - Orchestrates `usePagedPhotos` + upload/delete/favorite actions
   - `hooks/usePagedPhotos.js` - Cursor-paginated photo loading via `get_photos_page`
   - `hooks/useViewPhotoLoader.js` - Drives view-change → page-load, deduplicates identical queries
   - `hooks/useAsyncGuard.js` - Unmount-safe async guard (returns `activeRef`)
   - `utils/viewFilter.js` - Maps view modes to `ViewFilter` structs sent to the backend
   - `utils/viewQuery.js` - Resolves `strategy: 'paginated' | 'skip'` for each view
   - `config.js` - Shared constants (PAGE_SIZE, SEARCH_DEBOUNCE_MS, etc.)

3. **SQLite Database** (`~/Library/Application Support/terra/photos.db`)
   - Tables: `photos`, `albums`, `album_photos`, `tags`, `photo_tags`
   - Key schema columns: `path, name, date_taken, width, height, source_type, is_favorite, content_hash, latitude, longitude, location_name, dhash_64, is_screenshot, archived_at, reviewed_at, file_size`

### File Paths

- **Managed Library**: `~/Pictures/Terra/YYYY/MM/`
- **Archive**: `~/Pictures/Terra/Archive/` (14-day auto-delete)
- **Database**: `~/Library/Application Support/terra/photos.db`
- **Thumbnail Cache**: `~/Library/Application Support/terra/thumbs/<size>/<hash[0..2]>/<hash>.jpg`

### Pagination System

All views use cursor-based pagination via the `get_photos_page` Tauri command. The flow:

1. `ViewContext` detects a view change → calls `useViewPhotoLoader`
2. `useViewPhotoLoader` resolves a `ViewFilter` via `viewFilter.js` and loads page 1
3. `usePagedPhotos` appends subsequent pages when the user scrolls to the bottom
4. `CONFIG.PAGE_SIZE = 200` photos per page; `next_cursor` is `null` when exhausted

`ViewFilter` variants (defined in `db/pagination.rs`): `all`, `favorites`, `photos_only`, `videos_only`, `album`, `location`, `tags`, `search`, `smart_collection`, `archived`, `unreviewed`.

Views that return `strategy: 'skip'` (e.g. `search` before a query is typed, `tags` with no tags selected) do not trigger a backend call.

### Process-Wide DB Connection

`lib.rs` holds a single `OnceLock<Mutex<rusqlite::Connection>>`. Use these helpers:

```rust
// One-shot commands:
fn with_db<T, F>(op: &str, f: F) -> Result<T, String>

// Multi-step commands (explicit lock):
let conn = db_conn()?;
```

Never call `db::init_database()` directly from a command — use `with_db` or `db_conn()`.

### Key Data Flows

**Photo Import**: User selects files → `upload_photos()` → copies to managed library → `metadata_enrich::enrich_path()` → computes SHA-256 + dHash → screenshot detection → saves to DB

**Metadata Extraction Priority**: EXIF DateTimeOriginal → Filename (`YYYY-MM-DD_HHMMSS`) → File modified time → Current timestamp

**Duplicate Detection**: Exact via SHA-256 `content_hash`; similar via 64-bit `dhash_64` with Hamming distance ≤ 10

**Cloud Provider Import**: `imports.rs` discovers media in local export folders/ZIPs. Providers: `icloud_photos`, `google_photos`, `snapchat`, `local_export`. All funnel into the same managed-library pipeline as direct upload.

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
    with_db("my_command", |conn| {
        db::some_operation(conn, &param)
    })
}
```

2. Register in `run()` → `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    my_command,
    // ...
])
```

3. Call from React:
```javascript
const result = await invoke('my_command', { param: 'value' });
```

## Modifying Database Schema

1. Update schema in `db/schema.rs` → `init_database()` (uses `ALTER TABLE ADD COLUMN` for migrations)
2. Update `PhotoMetadata` struct in `lib.rs`
3. Update query mappings in the relevant `db/*.rs` module
4. Add index if needed for performance

## Key Dependencies

### Rust (`src-tauri/Cargo.toml`)
- `tauri = "2"` with `"protocol-asset"` feature
- `rusqlite = "0.32"` with `"bundled"` feature
- `rexif = "0.7"` - EXIF parsing
- `image = "0.25"`, `image_hasher = "2.0"` - Image processing and perceptual hashing
- `reverse_geocoder = "3.0"` - GPS → location names
- `rayon = "1.10"` - Parallel processing
- `sha2 = "0.10"` - Content hashing
- `zip` - ZIP extraction for provider exports
- `dirs` - Platform paths (data dir, pictures dir)

### JavaScript (`package.json`)
- `@tauri-apps/api = "^2.0.0"`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-shell`
- `react = "^18.2.0"`, `lucide-react`, `recharts`
- `react-virtuoso = "^4.18.6"` - Virtual scrolling for large photo lists

## Event System

Backend emits progress events for long-running operations:
- `scan_progress` - Duplicate scanning
- `screenshot_scan_progress` - Screenshot detection
- `file_size_progress` - File size population

```javascript
const unlisten = await listen('scan_progress', (event) => {
  // event.payload: { total, processed, phase }
});
```

## Debugging

1. **Thumbnails not loading**: Check `assetProtocol.scope` in `tauri.conf.json`, verify canonical paths
2. **EXIF date parsing fails**: Check console for "Failed to parse EXIF datetime" — filename parsing is the fallback
3. **Build fails after directory move**: Run `cd src-tauri && cargo clean`
4. **Stale page after mutation**: Call `paged.reloadCurrentView()` or `invalidateQueryKey()` before re-fetching
5. **Video playback issues**: Check codec support; MOV/MP4 work natively
