# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terra is a high-performance local photo gallery application for macOS built with Tauri v2, React, and Rust. It features a managed photo library system with SQLite caching, EXIF metadata extraction, and a unique glassy UI with animated ASCII dithered background.

## Development Commands

### Running the Application
```bash
npm run tauri:dev       # Start Tauri development server (includes Vite)
npm run dev             # Start Vite dev server only (for frontend-only work)
```

**Important**: First build takes 2-5 minutes for Rust compilation. After moving the project directory, run `cd src-tauri && cargo clean` to clear cached build artifacts with old paths.

### Building for Production
```bash
npm run tauri:build     # Creates macOS .app bundle in src-tauri/target/release/bundle/
npm run build           # Build frontend only
```

### Testing Rust Backend
```bash
cd src-tauri
cargo check             # Fast compilation check
cargo test              # Run tests (if any)
cargo build             # Build without running
```

## Architecture

### Three-Layer System

1. **Rust Backend** (`src-tauri/src/`)
   - `lib.rs` - Core photo processing with three Tauri commands:
     - `scan_directory(dir_path, save_to_db)` - Legacy directory scanning
     - `upload_photos(file_paths)` - **Primary import method** - copies photos to managed library
     - `get_all_photos()` - Retrieves all photos from SQLite database
   - `db.rs` - SQLite operations and library management
   - `main.rs` - Desktop entry point (just calls `terra_lib::run()`)

2. **React Frontend** (`src/App.jsx`)
   - Single-component architecture (350+ lines)
   - Uses Tauri's `invoke()` for backend communication
   - Uses Tauri's `convertFileSrc()` to convert file paths to `asset://` protocol URLs

3. **SQLite Database** (`~/Library/Application Support/terra/photos.db`)
   - Persists photo metadata for instant startup
   - Schema: `path, name, date_taken, width, height, source_type, created_at`
   - Indexed on `date_taken` for fast chronological sorting

### Managed Library System

**Critical**: Terra copies uploaded photos to `~/Pictures/Terra/YYYY/MM/` organized by date. The database stores canonical absolute paths to these managed files. The app does NOT directly read from arbitrary directories anymore.

**File Access Flow**:
1. User selects photos via dialog (frontend: `open()` from `@tauri-apps/plugin-dialog`)
2. Backend: `upload_photos()` copies to managed library, extracts metadata, saves to DB
3. Frontend: `loadPhotosFromDatabase()` fetches from DB, converts paths with `convertFileSrc()`
4. Images load via Tauri's `asset://` protocol (configured in `tauri.conf.json`)

### Metadata Extraction Pipeline

Date extraction follows this priority order:
1. **EXIF DateTimeOriginal/DateTime** (most accurate)
2. **Filename parsing** (e.g., `2017-11-26_030858.jpeg` → Nov 26, 2017 3:05:58 AM)
3. **File modified time** (fallback)
4. **Current timestamp** (last resort, logs warning)

**Why this matters**: HEIC files often lack EXIF support, so filename parsing is critical. The regex pattern is: `(\d{4})[_-](\d{2})[_-](\d{2})` with optional `_(\d{2})(\d{2})(\d{2})` for time.

## Tauri v2 Asset Protocol Configuration

**Critical for image display**: `tauri.conf.json` must include:
```json
"security": {
  "assetProtocol": {
    "enable": true,
    "scope": ["$PICTURE/**", "$DATA/**"]
  }
}
```

This allows `convertFileSrc()` to access files in `~/Pictures/Terra/` and `~/Library/Application Support/terra/`. Without this, thumbnails won't load.

## Common Modifications

### Adding a New Tauri Command

1. Add function to `src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Received: {}", param))
}
```

2. Register in `run()` function:
```rust
.invoke_handler(tauri::generate_handler![
    scan_directory,
    get_all_photos,
    upload_photos,
    my_command  // Add here
])
```

3. Call from React:
```javascript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('my_command', { param: 'value' });
```

### Modifying Database Schema

1. Update schema in `src-tauri/src/db.rs` → `init_database()`
2. Update `PhotoMetadata` struct in `src-tauri/src/lib.rs`
3. Update query mapping in `get_all_photos()`
4. **Important**: SQLite will auto-migrate with `CREATE TABLE IF NOT EXISTS`. For breaking changes, increment app version or add migration logic.

### Adding New Image Format Support

1. Add extension to filter in `scan_directory()` and `upload_photos()`:
```rust
matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "heic" | "webp" | "gif" | "bmp" | "tiff")
```

2. Ensure the `image` crate supports it (check `Cargo.toml` features if needed)

## File Structure Details

```
src-tauri/
├── src/
│   ├── lib.rs          # Core logic: 350+ lines with 3 commands + metadata extraction
│   ├── db.rs           # SQLite operations: 126 lines with 5 functions
│   └── main.rs         # 7 lines, calls terra_lib::run()
├── capabilities/
│   └── default.json    # Tauri v2 permissions (dialog, shell, etc.)
├── Cargo.toml          # Key deps: tauri v2, rusqlite, rexif, image, rayon, regex
└── tauri.conf.json     # Must have assetProtocol scope for $PICTURE

src/
├── App.jsx             # 350+ lines: DitherBackground, PhotoModal, main App
├── main.jsx            # React entry point
└── index.css           # Tailwind imports + custom scrollbar styles
```

## Performance Considerations

- **Parallel processing**: Uses `rayon` for multi-threaded photo processing (see `.par_iter()` in `upload_photos`)
- **Lazy loading**: Images use `loading="lazy"` attribute
- **Database indexing**: `date_taken` has descending index for fast chronological queries
- **Asset protocol**: Tauri's zero-copy file serving via `asset://` URLs

**Known limitation**: Virtual scrolling not implemented. For 50,000+ photos, the DOM will have performance issues. Future: integrate `react-window` or `react-virtualized`.

## Image Path Handling

**Critical distinction**:
- **Rust side**: Paths must be canonical absolute paths (use `.canonicalize()`)
- **React side**: Paths must be converted with `convertFileSrc(path)` to `asset://localhost/{id}`
- **Database**: Stores canonical paths from Rust

**Why canonicalize?**: Tauri's asset protocol requires absolute paths. Relative paths or symlinks will fail to load.

## UI Components

### DitherBackground Component
- Canvas-based ASCII art with animated bubbles
- 6-10 bubbles of varying sizes (20-80px radius)
- Bubbles float upward and wrap around
- Uses monospace font with character gradient: `" .:-=+*#%@"`

### View Modes
- **All Photos**: Single expandable group
- **Years**: Groups by `date.getFullYear()`
- **Months**: Groups by `date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })`

Photos are sorted chronologically (newest first) before grouping.

## Debugging Tips

1. **Thumbnails not loading**: Check Tauri console for `asset://` protocol errors. Verify `assetProtocol.scope` in `tauri.conf.json`.

2. **EXIF date parsing fails**: Look for "Failed to parse EXIF datetime" in console. Check if filename parsing caught it instead.

3. **Photos in wrong year/month folders**: The `upload_photos()` function creates folders based on `date_taken`. If date extraction failed, check the fallback chain.

4. **First build after directory move fails**: Run `cd src-tauri && cargo clean` to clear cached build artifacts.

5. **SQLite locked errors**: Database connection is created per-command. No connection pooling is used.

## Dependencies Overview

### Rust (`src-tauri/Cargo.toml`)
- `tauri = "2"` with `"protocol-asset"` feature (critical!)
- `rusqlite = "0.32"` with `"bundled"` feature (includes SQLite binary)
- `rexif = "0.7"` - EXIF parsing
- `image = "0.25"` - Image dimension detection
- `rayon = "1.10"` - Parallel processing
- `regex = "1"` - Filename date parsing
- `chrono = "0.4"` - Date/time handling

### JavaScript (`package.json`)
- `@tauri-apps/api = "^2.0.0"` - Core Tauri APIs
- `@tauri-apps/plugin-dialog = "^2.0.0"` - File picker
- `react = "^18.2.0"` - UI framework
- `lucide-react = "^0.294.0"` - Icon components

## Known Issues from README/Implementation Plan

- First scan can be slow on very large directories (sequential file ops)
- HEIC EXIF support is unreliable (hence filename parsing was added)
- Some EXIF formats may not parse correctly (depends on `rexif` library)
- Virtual scrolling needed for 50,000+ photos
- Cloud import buttons are UI-only placeholders

## Testing Workflow

1. Start app: `npm run tauri:dev`
2. Click "Upload Photos" button
3. Select images from a directory
4. Verify they appear in the correct year/month groups
5. Check `~/Pictures/Terra/YYYY/MM/` to confirm files were copied
6. Check console logs for date extraction method used

## Planned Features (from IMPLEMENTATION_PLAN.md)

- Virtual scrolling with react-window
- Search and filtering
- Favorites and collections
- iCloud/Google Photos integration
- Video support
- Basic editing (rotate, crop)
