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
- **Cloud Import** opens a provider import wizard for Apple Photos/iCloud, Google Photos, Snapchat, and generic local exports.
- Provider exports can be imported from local folders or ZIP archives.
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
- Gallery rendering uses `react-virtuoso` to avoid mounting every row at once.
- A feature-flagged cursor-pagination path exists for All Photos, with the legacy full-library load still default.

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

### Provider Export Imports

- `ImportWizard` gives provider-specific guidance and official download links.
- `import_provider_export` imports supported media from provider export folders or ZIP archives.
- `src-tauri/src/imports.rs` stages ZIP contents under Terra app data, ignores common sidecar files, and reports unsupported files.
- Imported provider media reuses the managed-library copy, hash dedupe, screenshot detection, file-size, and SQLite indexing path.
- Import summaries report discovered, imported, skipped duplicate, unsupported, and failed counts.

## Architecture Notes

- Frontend composition starts in `src/App.jsx`.
- `src/contexts/` owns app, view, and selection providers.
- `src/hooks/` owns feature state and frontend command orchestration.
- `src/components/` owns gallery, modal, cleanup, review, tag, and analytics UI.
- `src-tauri/src/lib.rs` owns Tauri command handlers and media-processing helpers.
- `src-tauri/src/db.rs` owns schema setup, lightweight migrations, and SQLite queries.
- `src-tauri/src/imports.rs` owns provider export folder/ZIP discovery.
- `src-tauri/src/thumbnails.rs` owns thumbnail cache paths and generation.

The main data path is:

1. React opens a file picker through the Tauri dialog plugin.
2. `upload_photos` or `import_provider_export` discovers supported media.
3. Rust copies selected files into the managed library.
4. Rust extracts metadata and inserts or updates the SQLite row.
5. React reloads database-backed media via Tauri commands.
6. Gallery, cleanup, review, and analytics views query the same metadata store.

## Known Limitations

- Cursor pagination is feature-flagged and only wired for the All Photos path so far.
- Video thumbnails are not generated yet.
- Similar duplicate grouping compares perceptual hashes pairwise, which may not scale well to very large libraries.
- Video dimensions are not extracted yet; videos currently store `0x0` dimensions.
- HEIC import is accepted by extension, but metadata and image processing depend on decoder support.
- Provider imports are local export based. Terra does not offer full-library sign-in imports where providers do not expose a supported public API.
- Google Takeout, Apple/iCloud, and Snapchat imports currently ingest media files; source-specific sidecar metadata reconciliation remains future work.

## Verification Snapshot

Latest known checks after installing dependencies:

- `npm run test:run`: 165 tests passed.
- `cargo test`: 74 Rust tests passed, with only unused-function warnings.
- `npm run build`: passed.
- `npm audit`: reported dependency vulnerabilities that should be evaluated separately.

## Next Engineering Frontier

The next development phase should deepen the work that now has a v1 foundation:

1. Cursor pagination rollout across all views and large-library validation.
2. Persisted import job history with preflight/dry-run summaries and per-item errors.
3. Google Takeout JSON sidecar and album/folder reconciliation.
4. Apple Photos automation or PhotoKit-assisted import helpers.
5. Snapchat/social archive metadata mapping.

See `docs/ROADMAP.md` for the high-level sequence.
