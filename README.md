# Terra - Local Photo Gallery

Terra is a local-first photo and video library for macOS. It is built for people who want an iOS/Google Photos-like browsing and cleanup experience without handing their whole library to another cloud subscription.

The app is currently a Tauri v2 desktop app with a React/Vite frontend, a Rust backend, and SQLite metadata storage. Photos are copied into a managed local Terra library, indexed with metadata, and presented through gallery, organization, review, and storage-cleanup workflows.

## Current Status

Terra has moved beyond the original scan-only MVP. The core local library is implemented:

- Managed local imports into a configurable Terra library folder.
- SQLite metadata cache for photos, albums, tags, settings, favorites, archive state, review state, hashes, locations, and file sizes.
- Gallery views for all media, years, months, locations, favorites, photos-only, videos-only, albums, tags, search results, and smart collections.
- Albums and bulk add-to-album workflows.
- Tags, bulk tagging, and per-photo tag management.
- Full-screen photo viewer and video playback.
- Duplicate detection using exact content hashes and perceptual hashes.
- Screenshot detection and review.
- Archive/restore flow with automatic cleanup after 14 days.
- TerraForm Review for quickly keeping or archiving unreviewed photos.
- Storage analytics for media type totals, largest files, storage by year/month, screenshots, and estimated duplicate savings.

Still planned:

- Generated thumbnail cache.
- Virtualized gallery rendering for very large libraries.
- Import pipelines for Google Photos Takeout, Apple Photos/iCloud, Snapchat, and other social/cloud archives.
- More advanced cloud migration tools and source-specific metadata reconciliation.

## Tech Stack

- Frontend: React 18 + Vite
- Desktop shell: Tauri v2
- Backend: Rust
- Database: SQLite via `rusqlite`
- Styling: Tailwind CSS
- Charts: Recharts
- Icons: Lucide React
- Metadata and media helpers: `rexif`, `image`, `sha2`, `image_hasher`, `reverse_geocoder`
- Performance: Rayon for parallel Rust processing

## Architecture

Terra is split across a React UI and a Rust command backend:

- `src/App.jsx` wires together the application layout and modals.
- `src/contexts/` coordinates app, view, and selection state.
- `src/hooks/` contains feature state for photos, albums, tags, cleanup, and selection.
- `src/components/` contains the gallery, sidebar, modals, review tools, analytics, and media viewer.
- `src-tauri/src/lib.rs` exposes Tauri commands and media-processing logic.
- `src-tauri/src/db.rs` owns SQLite schema creation, migrations, and queries.

The local data flow is:

1. The user selects media through **Upload Photos**.
2. Rust copies files into the managed Terra library, defaulting to `~/Pictures/Terra`.
3. Files are organized by year/month based on extracted date metadata.
4. Terra extracts EXIF, filename, filesystem, hash, location, screenshot, and size metadata where available.
5. SQLite stores the indexed metadata.
6. React reads through Tauri commands and renders gallery/review/analytics views.

## Prerequisites

- macOS 10.15 or newer
- Node.js 18 or newer
- Rust stable toolchain

Install dependencies:

```bash
npm install
```

Run the full Tauri development app:

```bash
npm run tauri:dev
```

Run only the Vite frontend:

```bash
npm run dev
```

## Usage

### Import Media

1. Launch Terra.
2. Click **Upload Photos** in the sidebar.
3. Select one or more supported media files.
4. Terra copies them into the managed library and indexes them in SQLite.

Supported import extensions currently include:

- Images: `jpg`, `jpeg`, `png`, `heic`, `webp`, `gif`, `bmp`
- Videos: `mp4`, `mov`, `avi`, `webm`, `mkv`

### Change Library Location

1. Open **Settings** from the sidebar.
2. Choose a new **Library Storage Path**.
3. New uploads will use the new path. Existing photos remain where they already are.

### Browse and Organize

- Use **All Photos**, **Years**, **Months**, **Locations**, **Favorites**, **Photos Only**, and **Videos Only** for built-in views.
- Create albums from the sidebar and bulk-add selected photos.
- Create tags, assign them in bulk, and manage tags from the photo modal.
- Use sidebar search to find photos by filename or location.
- Use smart collections for size, dimensions, time, and review status.

### Clean Up

- **Find Duplicates** scans for exact and visually similar media.
- **Find Screenshots** flags likely screenshots by filename and dimensions.
- **View Archive** restores archived items before they are permanently cleaned up.
- **TerraForm Review** provides a fast keep/archive triage workflow.
- **Storage Analytics** shows where local disk space is going and highlights large or duplicate media.

## Project Structure

```text
terra/
├── src/                    # React frontend
│   ├── components/         # Gallery, sidebar, modals, review and analytics UI
│   ├── contexts/           # App, view, and selection providers
│   ├── hooks/              # Photo, album, tag, cleanup, and selection state
│   ├── utils/              # Frontend helpers
│   ├── App.jsx             # Main application composition
│   └── main.jsx            # React entry point
├── src-tauri/              # Rust/Tauri backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands and media processing
│   │   ├── db.rs           # SQLite schema and queries
│   │   └── main.rs         # Desktop entry point
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── ROADMAP.md
├── package.json
└── vite.config.js
```

## Development Commands

```bash
npm run dev           # Start Vite only
npm run tauri:dev     # Start the full desktop app
npm run build         # Build frontend assets
npm run tauri:build   # Build the desktop app bundle
npm run test:run      # Run frontend tests once
```

Rust checks:

```bash
cd src-tauri
cargo test
cargo check
```

## Verification

After installing dependencies, the standard checks are:

```bash
npm run test:run      # frontend unit tests
npm run build         # frontend build
cd src-tauri
cargo test            # backend unit tests
cargo check           # backend type/lint check
```

`npm audit` may report dependency advisories that should be reviewed before each release.

## Known Limitations

- The gallery is not virtualized yet; very large libraries can create too many DOM nodes.
- Terra displays original local media files rather than a generated thumbnail cache.
- Similar-duplicate detection uses pairwise perceptual hash comparison and may need indexing for very large libraries.
- HEIC support depends on available image decoding support in the Rust image stack.
- Cloud/social import buttons are placeholders; no Google, iCloud, Dropbox, or Snapchat import flow is implemented yet.
- The Tauri asset scope is intentionally broad for local-library development and should be tightened before broader distribution.

## Roadmap

See `docs/ROADMAP.md` for the next planned sequence:

1. Thumbnail generation plus virtualized gallery rendering.
2. Generic import job system.
3. Google Photos Takeout folder/ZIP import.
4. Apple Photos/iCloud import path.
5. Snapchat/social archive import path.

## License

MIT License - see `LICENSE` for details.
