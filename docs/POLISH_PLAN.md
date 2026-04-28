# Terra Polish Plan — Toward iOS Photos / Google Photos Parity

This plan complements `docs/ROADMAP.md` (which captures the scale + imports
sequence) and adds the polish layer needed to make Terra feel comparable to
iOS Photos and Google Photos. Phases are ordered by perceived value × cost.

Some bigger-ticket Apple/Google features are intentionally deferred or out
of scope; rationale is at the bottom.

---

## Current State (what's solid)

- Tauri v2 + React 18 + Rust + SQLite foundation, 40+ commands, ~150 tests passing.
- Glass/dither visual identity, sidebar navigation, grouped grid (years/months/locations).
- Library management: managed import, content-hash dedupe, perceptual-hash similar duplicates,
  screenshot detection, archive with 14-day cleanup, TerraForm review, smart collections,
  storage analytics, tags + albums.
- Clean separation: `contexts/`, `hooks/`, `components/`; Rust split into `lib.rs` /
  `media.rs` / `db.rs`.

## Headline Gaps vs iOS Photos / Google Photos

1. **Photo viewer is shallow** — `PhotoModal.jsx` is 54 lines: no swipe/keyboard nav,
   no zoom/pan, no info panel (EXIF/GPS hidden), no delete from modal, no share.
2. **Scale story needs validation** — thumbnail caching and virtualized rendering now exist, but video thumbnails, full cursor pagination rollout, and 50k-100k library validation are still pending.
3. **Discovery is thin** — search is `LIKE %term%` on filename + location only, no
   filters, no memories, no map view despite GPS being indexed.
4. **Cloud/social imports need deeper source handling.** V1 folder/ZIP import exists for Apple/iCloud, Google Takeout, Snapchat, and generic local exports; persisted jobs and sidecar metadata reconciliation remain roadmap work.
5. **Video is half-supported** — playback works, but `width=0, height=0`, no duration,
   no thumbnail.

---

## Phase A — Photo Viewer & Polish Now (1–2 days)

These are cheap iOS-Photos-feel wins that don't need new pipelines or schema.

**A1. Photo modal navigation**
- ArrowLeft / ArrowRight / J / K to step through `flatVisiblePhotos`.
- Swipe gestures (touchpad horizontal scroll → next/prev) via React event handlers.
- Prev/Next buttons (left/right edge, fade in on hover) for discoverability.
- Verify: opening any photo lets you traverse the whole current view via keyboard
  alone, no mouse.

**A2. Zoom & pan**
- Wheel = zoom in/out around cursor; drag = pan when zoomed; double-click = toggle
  fit ↔ 100%.
- Pure CSS `transform` — no library needed.
- Verify: a 4000×3000 photo can be zoomed and panned smoothly without external deps.

**A3. Info panel**
- "i" key or button toggles a side drawer in the modal showing: full date/time,
  dimensions, file size, camera/lens (once Phase E lands), GPS + map mini-link,
  filename, full path, tags, album memberships.
- Read fields already on `PhotoMetadata`; surface them.
- Verify: every existing column in the `photos` table is visible from the modal.

**A4. Modal action bar**
- Add Delete (calls existing `delete_photos`), Archive, Add-to-album, Tag, Reveal-in-Finder.
- Wire a confirmation for Delete (irreversible) but not Archive (already reversible).

**A5. Keyboard layer**
- Global: `/` focuses search, `g` cycles view modes, `Esc` closes any modal.
- In modal: `f` favorite, `i` info, `Delete` archive, `Cmd+Backspace` delete.
- Implement via a single `useKeyboardShortcuts` hook in `src/hooks/`.

**A6. Loading & error polish**
- Replace spinner-only `PhotoGrid` empty/loading state with skeleton tiles
  (3-row × 5-col blurred placeholders) when `loading && photos.length === 0`.
- Surface Tauri error context: instead of generic strings, propagate root cause
  from Rust `Result::Err` into the toast UI.

**A7. Modal focus trap**
- Trap focus inside open modals; restore focus to triggering element on close.
- Tiny but separates "feels like an app" from "feels like a webpage."

**Dependencies added:** none. All achievable with React + CSS.

**Definition of done:** A user can do a full keep/discard pass on a day's worth of
photos without touching the mouse.

---

## Phase B — Scale Foundation (matches Roadmap #1) (3–5 days)

Already in `docs/ROADMAP.md`. Adding implementation specifics here so the polish
phases above can build on it without ambiguity.

**B1. Thumbnail pipeline (Rust)**
- New module `src-tauri/src/thumbnails.rs`.
- Sizes: 256² (grid), 1024² (preview), keep originals untouched.
- Cache root: `dirs::data_local_dir()/terra/thumbs/<size>/<sha256-prefix>/<sha256>.jpg`.
  Content-addressed avoids stale entries when a photo is moved.
- On import: compute thumbs in parallel via Rayon, write JPEG (quality 80).
- Backfill command: `generate_missing_thumbnails` with progress events.

**B2. Schema additions**
- Add `thumb_status TEXT` to photos (`pending|ready|failed`); no need to store
  paths since they're derived from `content_hash`.
- New command `get_thumb_path(content_hash, size)` returns canonical path.

**B3. Virtualization (frontend)**
- Use `react-virtuoso` (better than `react-window` for variable-height grouped
  layouts). Add `<GroupedVirtuoso>` to `PhotoGrid.jsx`, keep current sticky group
  headers and `expandedGroups` behavior.
- `PhotoCard` switches `src` to thumb URL via `convertFileSrc(thumbPath)`.

**B4. Asset-protocol scope**
- Extend `tauri.conf.json` `assetProtocol.scope` to include the thumb cache dir.

**Verify:** Library of 50k photos (synthetic if needed) loads within 2s and scrolls
at 60fps.

---

## Phase C — Discovery & Memories (3–5 days)

The biggest "feels like a real photos app" leap after Phase B.

**C1. FTS5 search**
- New virtual table: `photos_fts(name, location_name, content='photos', content_rowid='id')`.
- Triggers on insert/update/delete to keep in sync.
- Replace `LIKE %term%` query in `db.rs:393–402` with `MATCH`.
- Verify: search latency stays sub-100ms at 50k photos.

**C2. Composable filter UI**
- New `<FilterBar>` above `PhotoGrid` with chips: media type, date range,
  has-location, favorite, has-tag.
- Filters compose with `viewMode` and `searchQuery` inside `ViewContext`.
- iOS Photos lookalike: filter pill row, not a separate panel.

**C3. "Memories" / On This Day**
- New view mode `memories`. Backend command `get_memories(today_unix)` returns
  groups for: "On this day, N years ago" (date_taken ± 24h, year < current),
  "X days ago", "Last week."
- No ML, no curation — purely date math. Cheap, high perceived value.
- Sidebar entry under "View By."

**C4. Map view (optional, +1 day)**
- New view mode `map`. Render with `maplibre-gl` or `leaflet` (small, MIT-licensed).
- Cluster markers; click cluster → grid filtered to that cluster's photos.
- Reuse `idx_location_name` and lat/lon already in DB.

**C5. Smart Collection extensibility**
- Replace hardcoded collection IDs in `db.rs:752–917` with a `smart_collections`
  table: `id, name, rule_json, created_at`. Rule = small JSON DSL (filters joined
  with AND/OR).
- One generic `get_smart_collection_photos(id)` materializes the SQL from the rule.
- User-editable in a "New Smart Collection" modal.

**Verify:** "Find photos from Paris in July 2024 that I favorited" is one clear
sequence (search "Paris" → date filter → favorite filter), under 5 seconds.

---

## Phase D — Imports (matches Roadmap #2–#5) (5–8 days)

Follow the roadmap as written; add these specifics:

**D1. Generic ImportJob domain (Rust)**
- Current v1: `src-tauri/src/imports.rs` discovers media inside provider export folders or ZIPs, and `import_provider_export` returns summary counts with progress events.
- Next: split into `src-tauri/src/imports/` submodules per source as complexity grows.
- New tables: `import_jobs(id, source, status, progress, totals, errors_json,
  started_at, finished_at)`, `import_job_items(job_id, src_path, status,
  reason, photo_id)`.
- Phases: preflight (count, size, dedupe estimate) → execute → reconcile.
- Progress events: keep `provider_import_progress` for v1 or migrate to
  `import_progress` / `import_complete` when jobs are persisted.

**D2. Adapters** (in priority order, each = 1–2 days):
- `imports/google_takeout.rs` — walk Takeout dirs, pair media with `.json`
  sidecars, prefer sidecar `photoTakenTime` over file mtime.
- `imports/apple_export.rs` — Photos.app "Export Originals" + AppleScript helper
  for album metadata.
- `imports/snapchat.rs` — generic ZIP archive walker; document gaps.

**D3. Imports UI**
- Sidebar "Imports" entry (active job badge with progress).
- Modal showing job timeline, error list, "open Finder to first failed file" action.

**Verify:** A 10k-item Google Takeout import runs to completion with a clear
report of imported / skipped-as-duplicate / unsupported / failed counts.

---

## Phase E — Media Completeness (3–4 days)

**E1. Video metadata**
- Add `ffmpeg-next` (binds libavformat) or shell-out to `ffprobe` (lighter; comes
  with macOS Homebrew but not bundled — bundling it is the call to make).
- Recommendation: shell-out to `ffprobe` and ship instructions; Apple has it
  available via several common paths. Falls back to filename inspection.
- Extract: width, height, duration_ms, codec.
- New columns: `duration_ms INTEGER`, `codec TEXT`.

**E2. Video thumbnails**
- Single frame at 1s (or 10% of duration, whichever smaller) into the thumb cache.
- Use the same pipeline as Phase B, write JPEG.

**E3. Camera EXIF**
- Already extracting via `rexif`; not stored. Add columns: `camera_make`,
  `camera_model`, `lens_model`, `focal_length_mm`, `f_stop`, `shutter_us`, `iso`.
- Surface in info panel (Phase A3) and as filter dimensions (Phase C2).

**E4. Date-taken editing**
- Per-photo: edit-pencil button in info panel → date/time picker → backend
  `set_photo_date_taken(path, unix)`.
- Bulk: in selection toolbar, "Shift dates by…" (ISO offset) or "Set all to…".
- Mirror EXIF write back if possible (rexif is read-only — accept storing only
  in DB, document caveat).

**E5. HEIC robustness**
- `image` crate doesn't decode HEIC by default. Either:
  - Add `image` `heic` feature (requires libheif system dep), or
  - Convert HEIC → JPEG once during import using `heic-rs` or `magick` shell-out.
- Recommendation: convert-on-import to JPEG for thumb generation, keep original
  on disk.

**Verify:** A video import shows correct dimensions, duration, and a thumbnail
in the grid.

---

## Phase F — Light Editing (4–6 days, optional)

Match iOS Photos basics, no Photoshop ambitions.

**F1. Edit history schema**
- `photo_edits(id, photo_path, edit_json, created_at, applied_at)`. Originals
  never overwritten — edits are layered on top, exported on demand.

**F2. Crop & rotate**
- Canvas-based, in-modal. No backend. Save crop as edit record.
- "Reset" reverts all edits.

**F3. Light/color adjustments**
- Brightness, contrast, saturation, warmth via WebGL or `<canvas>` shader. Same
  edit-record approach.

**F4. Markup (defer)**
- iOS Photos has annotation. Reasonable to skip for v1; revisit if requested.

**Verify:** A photo can be cropped and color-adjusted, the edit can be reset to
original, and the edit persists across app restart.

---

## Deferred / Out of Scope (with rationale)

- **Face & people detection.** Requires an ML stack (`candle` or `onnx-runtime`
  + a face-detection / face-embedding model, plus clustering). Adds material
  binary size and complexity. Defer until after Phase E. If pursued, prefer
  Apple's Vision framework via a Swift sidecar over bundled ML.
- **OCR / scene tags.** Same reasoning — viable via macOS Vision framework but
  significant integration cost. Not blocking polish goals.
- **Cloud sync, shared albums, share links.** Contradicts the local-first design
  recorded in `ROADMAP.md`. Out of scope unless requirements change.
- **RAW / ProRAW / Cinematic / ProRes.** Niche; complex codecs. Defer.
- **Print, Books, Projects.** Apple-specific commerce; skip.

---

## Recommended Sequencing

Phases A → B → C in order; A + parts of E (camera EXIF) can interleave because
they don't share files. D can run concurrently with C once B lands. F is
optional and best done last.

| Phase | Estimated effort | Unblocks |
|------|-----------------|----------|
| A — Polish now | 1–2 days | Daily-driver feel |
| B — Thumbnails + virtualization | 3–5 days | Everything else |
| C — Discovery & memories | 3–5 days | Library you can actually browse |
| D — Imports | 5–8 days | Migrating from iCloud / Google |
| E — Media completeness | 3–4 days | Filtering, video parity |
| F — Editing | 4–6 days | iOS-Photos-equivalent workflow |

Total: ~3–5 focused weeks for full sequence.

---

## Open Questions

1. **HEIC handling** — bundle `libheif` (system dep) or convert-on-import? Affects
   ease of distribution.
2. **Map dependency** — accept `maplibre-gl` (~600kb) or skip map view?
3. **ffprobe** — bundle a static `ffprobe` binary in `src-tauri/binaries/` or
   require user-installed? Bundling adds ~50MB but removes a setup step.
4. **EXIF write-back** — accept that date/metadata edits are DB-only, or invest
   in a write-capable EXIF library (`kamadak-exif` reads, `exif-rs` writes some
   tags)?
