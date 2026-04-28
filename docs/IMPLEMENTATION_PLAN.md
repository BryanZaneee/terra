# Terra - Current Technical Snapshot

## Overview

Terra is a local-first photo and video manager for macOS. The original MVP centered on scanning folders and rendering a basic gallery; the current app now has a managed local library, SQLite-backed metadata, organization tools, cleanup workflows, and storage analytics.

This document records the current implementation state. The next feature sequence lives in `docs/ROADMAP.md`.

## Implemented Capabilities

### Desktop App Foundation

- Tauri v2 desktop shell with React 18 and Vite.
- Tailwind-based glassy/dithered visual system.
- Error boundary and test setup for frontend components/hooks.
- Tauri asset protocol configured for local media display.

### Managed Local Library

- **Upload Photos** copies selected media into the Terra managed library.
- Default library path is `~/Pictures/Terra`.
- Users can change the library storage path from Settings.
- New imports are organized into year/month folders based on date metadata.
- Duplicate imports are skipped when the SHA-256 content hash already exists.

### Metadata and Database

- SQLite database stored in the local app data directory.
- Schema covers photos, albums, album membership, tags, tag membership, and settings.
- Photo metadata includes path, name, date, dimensions, favorite state, content hash, GPS coordinates, location name, perceptual hash, screenshot flag, archive state, review state, and file size.
- Date extraction uses EXIF first, then filename parsing, then file modified time, then current time as a last resort.
- GPS coordinates are reverse geocoded when present.

### Gallery and Organization

- Gallery views include all media, years, months, locations, favorites, photos-only, videos-only, albums, tags, search results, and smart collections.
- Full-screen photo modal shows media metadata, favorites, and tags.
- Video playback is supported for imported video files.
- Albums can be created and populated from selected photos.
- Tags can be created, bulk-applied, searched, assigned, and removed per photo.
- Sidebar search queries filename and location.

### Cleanup and Review

- Exact duplicate detection uses SHA-256 content hashes.
- Similar duplicate detection uses 64-bit perceptual hashes and Hamming distance.
- Screenshot detection uses filename patterns and common screenshot dimensions.
- Archive moves media into an archive folder and marks `archived_at`.
- Archived photos can be restored before automatic cleanup.
- Archived items older than 14 days are permanently removed on startup cleanup.
- TerraForm Review provides a fast keep/archive workflow for unreviewed photos, with undo support.

### Storage Analytics and Smart Collections

- Smart collections group media by size, dimension, time, and review status.
- File-size population can be run as a one-time scan.
- Storage Analytics shows total size, photo/video/screenshot totals, storage by year/month, largest files, and estimated duplicate savings.

## Architecture Notes

- Frontend composition starts in `src/App.jsx`.
- `src/contexts/` owns app, view, and selection providers.
- `src/hooks/` owns feature state and frontend command orchestration.
- `src/components/` owns gallery, modal, cleanup, review, tag, and analytics UI.
- `src-tauri/src/lib.rs` owns Tauri command handlers and media-processing helpers.
- `src-tauri/src/db.rs` owns schema setup, lightweight migrations, and SQLite queries.

The main data path is:

1. React opens a file picker through the Tauri dialog plugin.
2. `upload_photos` copies selected files into the managed library.
3. Rust extracts metadata and inserts or updates the SQLite row.
4. React reloads database-backed media via Tauri commands.
5. Gallery, cleanup, review, and analytics views query the same metadata store.

## Known Limitations

- The gallery is not virtualized. Current rendering still creates DOM nodes for every visible group item.
- There is no generated thumbnail cache. The UI displays original local media files through Tauri asset URLs.
- Similar duplicate grouping compares perceptual hashes pairwise, which may not scale well to very large libraries.
- Video dimensions are not extracted yet; videos currently store `0x0` dimensions.
- HEIC import is accepted by extension, but metadata and image processing depend on decoder support.
- Cloud/social import buttons are placeholders. There is no Google Photos, Apple Photos/iCloud, Dropbox/Drive, or Snapchat archive importer yet.
- Documentation now reflects current functionality, but deeper implementation plans for the next roadmap items are still pending.

## Verification Snapshot

Latest known checks after installing dependencies:

- `npm run test:run`: 103 tests passed.
- `npm run build`: passed, with a large bundle warning around the main JavaScript chunk.
- `cargo test`: 48 tests passed, with only unused-function warnings.
- `npm audit`: reported dependency vulnerabilities that should be evaluated separately.

## Next Engineering Frontier

The next development phase should focus on scale and imports:

1. Thumbnail generation plus virtualized gallery rendering.
2. Generic import job system.
3. Google Photos Takeout folder/ZIP import.
4. Apple Photos/iCloud import path.
5. Snapchat/social archive import path.

See `docs/ROADMAP.md` for the high-level sequence.
