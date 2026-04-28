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
- Generated thumbnail cache for photo grid performance.
- Virtualized gallery rendering through `react-virtuoso`.
- Duplicate detection using exact content hashes and perceptual hashes.
- Screenshot detection and review.
- Archive/restore flow with automatic cleanup after 14 days.
- TerraForm Review for quickly keeping or archiving unreviewed photos.
- Storage analytics for media type totals, largest files, storage by year/month, screenshots, and estimated duplicate savings.
- Provider import wizard for Apple Photos/iCloud, Google Photos, Snapchat, and generic local exports.
- Local folder/ZIP export ingestion with SHA-256 dedupe, progress events, and imported/duplicate/unsupported/failed summaries.

Still planned:

- Persisted import job history, dry-run/preflight summaries, and per-item failure records.
- Source-specific metadata reconciliation for Google Takeout JSON sidecars, Apple export sidecars, and Snapchat archive metadata.
- Direct provider integrations only where a supported public API exists, such as a future Google Photos Picker selected-item flow.
- Video thumbnail generation and deeper HEIC handling.

## Tech Stack

- Frontend: React 18 + Vite
- Desktop shell: Tauri v2
- Backend: Rust
- Database: SQLite via `rusqlite`
- Styling: Tailwind CSS
- Charts: Recharts
- Icons: Lucide React
- Gallery virtualization: React Virtuoso
- Metadata and media helpers: `rexif`, `image`, `sha2`, `image_hasher`, `reverse_geocoder`, `zip`
- Performance: Rayon for parallel Rust processing

## Architecture

Terra is split across a React UI and a Rust command backend:

- `src/App.jsx` wires together the application layout and modals.
- `src/contexts/` coordinates app, view, and selection state.
- `src/hooks/` contains feature state for photos, albums, tags, cleanup, and selection.
- `src/components/` contains the gallery, sidebar, modals, review tools, analytics, and media viewer.
- `src-tauri/src/lib.rs` exposes Tauri commands and media-processing logic.
- `src-tauri/src/db.rs` owns SQLite schema creation, migrations, and queries.
- `src-tauri/src/imports.rs` discovers supported media inside provider export folders or ZIP files.
- `src-tauri/src/thumbnails.rs` owns the content-addressed thumbnail cache.

The local data flow is:

1. The user selects media through **Upload Photos** or chooses a provider export from **Cloud Import**.
2. Rust discovers supported media, extracting ZIP exports into a temporary Terra staging folder when needed.
3. Rust copies files into the managed Terra library, defaulting to `~/Pictures/Terra`.
4. Files are organized by year/month based on extracted date metadata.
5. Terra extracts EXIF, filename, filesystem, hash, location, screenshot, and size metadata where available.
6. SQLite stores the indexed metadata and source type.
7. React reads through Tauri commands and renders gallery/review/analytics views.

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

### Import Provider Exports

1. Use **Cloud Import** in the sidebar.
2. Pick **iCloud Photos**, **Google Photos**, **Snapchat**, or **Local Export**.
3. Follow the provider-specific download instructions in the wizard.
4. Choose the downloaded folder or ZIP archive.
5. Terra imports supported media, skips duplicate content hashes, and reports imported, duplicate, unsupported, and failed counts.

Provider notes:

- Apple Photos/iCloud: Terra supports local export folders, iCloud download folders, and ZIPs. There is no public full-library iCloud Photos OAuth import in this implementation.
- Google Photos: use Google Takeout for full-library imports. Google Photos Picker can be considered later for selected-item imports.
- Snapchat: use Snapchat My Data exports. Terra imports local archive media; deeper Memories metadata reconciliation is still future work.

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
│   │   ├── imports.rs      # Provider export folder/ZIP discovery
│   │   ├── thumbnails.rs   # Thumbnail cache generation
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

- Large-library validation is still pending even though gallery rendering is virtualized.
- Cursor pagination is behind a feature flag; the default app still loads the full library into frontend state.
- Video thumbnails are not generated yet.
- Similar-duplicate detection uses pairwise perceptual hash comparison and may need indexing for very large libraries.
- HEIC support depends on available image decoding support in the Rust image stack.
- Provider imports are export-based. Terra does not scrape iCloud/Snapchat or offer full-library provider sign-in import where no supported public API exists.
- Google Takeout, Apple/iCloud exports, and Snapchat archives currently import media files; provider sidecar metadata reconciliation is still limited.
- The Tauri asset scope is intentionally broad for local-library development and should be tightened before broader distribution.

## Roadmap

See `docs/ROADMAP.md` for the next planned sequence:

1. Finish scale work: cursor pagination rollout, video thumbnails, and large-library validation.
2. Persist import job history and per-item errors.
3. Deepen Google Takeout sidecar metadata and album/folder reconciliation.
4. Explore Apple Photos automation or PhotoKit-assisted import helpers.
5. Deepen Snapchat/social archive metadata handling.

## License

MIT License - see `LICENSE` for details.
