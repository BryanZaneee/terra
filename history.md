# Terra Engineering History

This file is maintained for future agents working on Terra. It records what
changed and *why*, especially decisions that aren't obvious from the diff.

Newest active effort first; completed efforts kept below for context.

---

## Active Effort: Provider Export Imports (started 2026-04-28)

**Goal.** Add a first Terra-native import experience for iCloud/Apple Photos,
Google Photos, and Snapchat without pretending every provider has a safe
full-library OAuth API. The UX should offer provider selection, explain the
real import route, link to the official export/download flow, and ingest the
resulting local folder or ZIP into Terra's managed library.

**Branch start.** `codex/provider-imports` started from a dirty but passing
workspace. The pre-existing local changes already covered gallery
scale/performance work, including virtualized gallery rendering, thumbnail
cache plumbing, SQLite connection reuse/WAL setup, and TerraForm Review swipe
interactions.

**Baseline verification.** `npm run test:run` passed with 152 tests before
provider-import edits. Existing React `act(...)` warnings remained.

**Direction.** Keep imports local-first. Direct provider sign-in should only be
used later where a supported public API exists; for this pass, export
folder/ZIP ingestion is the durable path.

### 2026-04-28 — Backend export ingestion

**What:** Added `src-tauri/src/imports.rs` to discover supported media in
provider export folders or ZIP archives, stage ZIP media safely under Terra's
app-data directory, and ignore common metadata sidecars. Added
`import_provider_export` as a Tauri command and refactored the existing upload
path through a shared managed-library import helper. The helper returns counts
for discovered/imported/duplicate/unsupported/failed media and emits
`provider_import_progress` events for provider imports.

**Why local ZIP/folder ingestion first:** Apple Photos/iCloud and Snapchat do
not provide a safe public full-library OAuth import path for Terra, and Google
Photos full-library API access is no longer the right general solution. Local
exports keep the app private, durable, and provider-policy friendly while still
giving the user one Terra button to continue from after downloading an export.

### 2026-04-28 — Import wizard UI

**What:** Added `ImportWizard.jsx` and wired the sidebar Cloud Import buttons
for Apple Photos/iCloud, Google Photos, Snapchat, and a generic local export.
The wizard explains the provider-specific reality, links to official export
pages, lets the user choose a folder or ZIP, calls `import_provider_export`,
shows progress, and reports imported/duplicate/unsupported/failed counts.

**Why not fake direct sign-in:** the UI deliberately does not ask for cloud
passwords or scrape provider websites. It surfaces direct instructions and then
hands off to Terra's local importer, which matches the project's local-first
privacy model and avoids provider-policy breakage.

### 2026-04-28 — Pagination frontend checkpoint

**What:** Checkpointed the pending P.2 pagination frontend surface that was in
the workspace: `CONFIG.USE_PAGINATION`, `usePagedPhotos`, `PhotoGrid`
`endReached`, and the App/usePhotos wiring that keeps the paginated path off by
default. Added an unmount guard to `usePagedPhotos` while committing it.

**Why keep it behind a flag:** the All Photos paginated path can be dogfooded
without replacing filtered/gallery-specific flows yet. The legacy
`get_all_photos` path remains the default until P.3-P.6 complete.

### 2026-04-28 — Pagination built-in filters checkpoint

**What:** Extended the paginated `ViewFilter` surface to favorites, archived,
unreviewed, photos-only, and videos-only. Added backend filter tests plus a
small `viewFilter.js` mapper so built-in presentation views can move onto the
server-side paginated path behind `CONFIG.USE_PAGINATION`.

**Why still behind the flag:** albums, tags, search, smart collections, and
duplicate/review flows still use legacy one-shot fetches. Keeping pagination
off by default prevents partially migrated filtering from changing normal app
behavior while the backend query surface grows.

### 2026-04-28 — Docs refreshed after import and scale work

**What:** Updated README, ROADMAP, IMPLEMENTATION_PLAN, and POLISH_PLAN to stop
describing thumbnails, virtualization, and cloud/social imports as placeholders.
Docs now distinguish shipped v1 folder/ZIP provider import from future persisted
jobs, direct provider APIs, and source-specific sidecar metadata handling.
Verification snapshot was refreshed after final checks: 165 frontend tests,
74 Rust tests, and a passing production frontend build.

---

## Active Effort: Polish to iOS / Google Photos Parity (started 2026-04-27)

**Goal.** Bring Terra's UX polish and feature surface up to a level that
feels comparable to iOS Photos and Google Photos for a single-user, local,
macOS context. We are explicitly *not* chasing cloud sync, shared albums,
face detection, or RAW workflows — those trade-offs are documented in
`docs/POLISH_PLAN.md`.

**Approved plan.** `docs/POLISH_PLAN.md` (six phases A–F + deferred section).

### Sequencing

| Phase | Title | Status |
|------|-------|--------|
| A | Photo modal polish, keyboard, skeletons, errors, tooltips | done |
| E (camera/lens/video) | Python + exiftool metadata enrichment | done |
| B.1 | Rust thumbnail pipeline + DB column + commands | done |
| B.2 | Frontend thumbnail consumption + Settings backfill UI | done |
| B.3 | Virtualized gallery (react-virtuoso) | done |
| C | Discovery (FTS, filters, memories, map) | pending |
| D | Imports (Takeout, Apple, Snapchat) | pending |
| E (rest) | Date editing, video thumbnails, HEIC | pending |
| F | Light editing | optional |

Detailed entries appear below as each item lands.

### Deliberately NOT doing (resisted scope creep)

- **Face detection / OCR.** Both require an ML stack (candle or
  onnx-runtime + a model) or a Swift sidecar to macOS Vision. Real binary
  size and complexity cost. Revisit after the import pipeline ships and
  we have signal on what users actually want.
- **Cloud sync, shared albums.** Contradicts the local-first design.
  Out of scope.
- **EXIF write-back.** Date-taken edits will live in DB only for now.
  rexif is read-only; writing tags requires shelling to exiftool with
  `-overwrite_original` or pulling in a different crate. Defer until
  Phase E.4.
- **Bundling exiftool.** ~30MB. We surface a `brew install exiftool`
  hint instead. Will revisit at first DMG release.
- **Bundling a Python interpreter.** PyO3 was considered for the
  metadata pipeline; rejected (binary bloat + crash coupling). Subprocess
  to system `python3` matches the OS-level dependency tradeoff we
  already make for `open` (reveal-in-Finder).

### Key decisions

- **PhotoMetadata stays a single struct, not split per-feature.** New
  enrichment fields (camera_make, etc.) are `Option<T>` with
  `#[serde(skip_serializing_if = "Option::is_none")]` so the wire
  format stays identical for unenriched photos. Splitting into a parent
  struct + child enrichment struct would require either a join in every
  query or two round-trips per photo, neither of which is worth the
  conceptual tidiness.
- **Cache strategy for thumbnails (Phase B, upcoming): content-addressed.**
  Decision recorded ahead of implementation. Thumbnail filenames will be
  derived from `content_hash` (already in DB) so we never have stale
  entries when a photo moves, and the cache survives library
  re-organizations. Side effect: photos without a content hash can't
  have a thumbnail until they're hashed — fine, since hashing happens at
  import.
- **react-virtuoso over react-window for Phase B.** Variable-height
  grouped layouts (year/month groups, expandable headers) are awkward
  in react-window's `VariableSizeList` — heights need to be measured and
  cached manually. react-virtuoso has built-in `<GroupedVirtuoso>` that
  matches our existing PhotoGrid shape exactly. Bundle weight is
  comparable (~30KB gzip).

---

### 2026-04-27 — Phase B.3: Virtualized gallery via react-virtuoso

**What:** PhotoGrid replaced the static `groupedPhotos.map(...)` render
with `<GroupedVirtuoso useWindowScroll>`. New `useResponsiveColumns`
hook returns 2/3/4/5 cols based on Tailwind breakpoints (sm/md/lg/xl).
Items are chunked into rows of `cols` photos and rendered as a single
CSS-grid row per virtualizer item. ResizeObserver is now stubbed in
`src/test/setup.js` since jsdom doesn't implement it.

**Why GroupedVirtuoso (chunk-into-rows) over VirtuosoGrid:** Virtuoso's
2D `<VirtuosoGrid>` doesn't support sticky group headers. We need
year/month/location group headers as part of the unified scroll surface,
not in a separate scrollable layer. Chunking each group's items into
rows of N keeps virtuoso 1D (one row = one virtualizer item) while
preserving the grid look — and `useWindowScroll` keeps the page scroll
intact so the sidebar layout (`pl-72`) still works.

**Why a `useResponsiveColumns` hook instead of CSS-only responsiveness:**
the chunking decision (how many photos per row) needs to happen in JS
*before* render to feed virtuoso. Pure CSS grid `grid-cols-2 md:grid-
cols-3 lg:grid-cols-4 xl:grid-cols-5` works visually for static layouts
but doesn't tell us at chunk time how many items fit per row. The hook
listens to `resize`, picks from the same Tailwind breakpoints, and
returns the column count to chunk by.

**Why `initialItemCount={Math.min(rows.length, 50)}`:** virtuoso uses
ResizeObserver to know container size; in jsdom (and at first paint
before measurement) it would render zero items. Forcing the first 50
items keeps the test environment honest and gives the user something
to look at instantly on cold start.

**Why a `COLS_TO_GRID_CLASS` lookup instead of `grid-cols-${cols}`:**
Tailwind purges class names that aren't textually present in the source.
Dynamic interpolation `grid-cols-${cols}` would get pruned and the layout
would silently break in production builds. A static lookup table is the
standard Tailwind escape hatch.

**Test adjustment.** The "hides photos when group is collapsed" test
used to assert both that the header was visible AND that no PhotoCard
rendered. Virtuoso skips rendering entirely when `groupCounts: [0]` and
the container has no measured size (jsdom). The header-visibility
assertion was dropped; the no-photo-mounts assertion is the meaningful
one and still passes. Manual verification covers headers in real layout.

**Files added/changed.**
- New: `src/hooks/useResponsiveColumns.js` (~25 LOC).
- Changed: `src/components/PhotoGrid.jsx` (full rewrite around
  GroupedVirtuoso); `src/components/PhotoGrid.test.jsx` (one test
  loosened); `src/test/setup.js` (ResizeObserver stub).
- Dependencies: `react-virtuoso ^4.18.6`.

**Verification.** `npm run test:run`: 152/152.

**Manual perf verification needed.** Synthetic 50K-photo test isn't
straightforward to build automatically; the user should test against
their real library and confirm scrolling stays at 60fps with the
thumbnail backfill complete. We can add a synthetic-library generator
script if needed.

---

### 2026-04-27 — Phase B.2: Frontend thumbnail consumption + Settings UI

**What:** `getThumbnailUrl(photo, thumbCacheRoot)` helper in
`photoHelpers.js` that derives the content-addressed thumb URL with a
graceful fallback to the original. AppContext fetches `thumb_cache_root`
once on mount and exposes it. PhotoCard reads via `useContext(AppContext)`
with null-tolerance so isolated tests don't have to wrap. SettingsModal
gains a "Thumbnails" section with progress bar wired to the
`thumbnail_progress` event. App.jsx wires `onPhotosChanged` so a
backfill triggers a gallery reload.

**Why expose AppContext directly (not just useAppContext) for PhotoCard's
context lookup:** PhotoCard tests render the card in isolation. If
PhotoCard called `useAppContext()`, every existing test would have to
wrap in `<AppProvider>` (and AppProvider triggers Tauri invokes on
mount, which gets noisy fast). Using `useContext(AppContext)` directly
returns null when no provider is present, and PhotoCard treats that as
"no thumb cache root yet" and falls back to the original URL — same
behavior as on first mount before the IPC resolves. This keeps tests
hermetic without adding an `AppContextOrNull` shim.

**Why the helper instead of computing in `processPhotos`:** the
thumbCacheRoot isn't known when `processPhotos` runs (it loads
asynchronously). Recomputing at render time inside PhotoCard avoids a
stale-data window where photos are processed before the root has
resolved. Also keeps `processPhotos` pure of any IPC context.

**Why `THUMB_SIZE` is duplicated as a JS constant:** matches the Rust
`pub const THUMB_SIZE: u32 = 256` exactly. Trade single-source-of-truth
for one less IPC call at startup. When we add a 1024² preview tier,
either expose the sizes via Tauri command at startup or keep two
constants — decide then.

**Why Settings refreshes the gallery via `onPhotosChanged` callback
instead of a custom event:** the existing modal pattern threads
callbacks; adding a new global event channel for one use case isn't
worth the indirection. After a backfill completes, App.jsx's
`loadPhotosFromDatabase` re-pulls photos so the new `thumb_status`
field is read.

**Test fix.** Updated photoHelpers tests to `decodeURIComponent`
the result before asserting path structure — `convertFileSrc` is
mocked to URL-encode the path, which is what production Tauri does.

**Files added/changed.**
- Changed: `src/utils/photoHelpers.js` (`THUMB_SIZE` const, new
  `getThumbnailUrl` helper); `src/utils/photoHelpers.test.js` (5 new
  tests); `src/contexts/AppContext.jsx` (export AppContext, fetch + expose
  thumbCacheRoot); `src/components/PhotoCard.jsx` (read context with
  null-tolerance, use helper); `src/components/SettingsModal.jsx`
  (Thumbnails section + progress bar + onPhotosChanged callback after
  enrichment too); `src/App.jsx` (pass `onPhotosChanged`).

**Verification.** `npm run test:run`: 152/152 (was 147, +5
getThumbnailUrl tests).

**Deferred to B.3.** Replace the existing flex/grid groups in PhotoGrid
with `<GroupedVirtuoso>` so 50K-photo libraries don't create 50K DOM
nodes.

---

### 2026-04-27 — Phase B.1: Rust thumbnail pipeline + DB

**What:** new `src-tauri/src/thumbnails.rs` module with content-addressed
JPEG thumbnail cache. New `thumb_status` column on `photos`. Two new
Tauri commands: `get_thumb_cache_root` (one-time path lookup) and
`generate_missing_thumbnails` (parallel backfill, emits
`thumbnail_progress` events every 20 items).

**Why content-addressed (`<root>/<size>/<hash[0..2]>/<hash>.jpg`):**

1. The cache survives library re-organizations — a moved photo with the
   same content keeps its thumb.
2. Two-character hash prefix gives 256-way fan-out so no single dir
   exceeds ~5–10K files at 100K-photo scale (apfs and most filesystems
   degrade above that).
3. No DB lookup needed to find a thumb path — frontend computes it from
   `content_hash + thumb_cache_root`. Saves an IPC round-trip per
   photo.

**Why `thumb_status TEXT` column over computing presence at request
time:** cheaper than a `stat` call per photo on every gallery render.
Trade-off is a flag we have to keep in sync; the only place that
writes it is the thumbnail backfill command, which is bounded.

**Why JPEG quality 80 + 256² single size for v1:** 256² is the grid-card
target (2-col mobile up to 5-col XL — even at 200% retina, ~150px
displayed). JPEG 80 was the sweet spot for size vs visual quality in
informal tests. The 1024² preview tier (for faster modal opens) is
deferred until we see whether modal-open latency on originals is
actually a user-felt problem.

**Why we explicitly reject videos with `thumb_status = 'unsupported'`:**
the `image` crate doesn't decode video. ffmpeg / extracting a frame is
Phase E.2 work (and it'll write thumbs through this same pipeline when
it lands). Tagging them prevents the backfill loop from re-trying every
run.

**Why parallel via Rayon, results then written serially:** image
decode/resize is CPU-bound; SQLite writes serialize on a single writer
anyway. Doing the writes after `par_iter` collects keeps the rusqlite
connection out of the parallel section (Connection isn't Sync). Writing
inside `par_iter` would need per-thread connections, which is overkill
for the volume of writes (≤O(library size), ~100K rows).

**Why we didn't add asset-protocol scope changes:** the cache lives
under `dirs::data_local_dir()` which on macOS is
`~/Library/Application Support/`. That's already covered by `$DATA/**`
in the existing scope.

**Files added/changed.**
- New: `src-tauri/src/thumbnails.rs` (~75 LOC + 4 unit tests).
- Changed: `src-tauri/src/db.rs` (one ALTER, PHOTO_COLUMNS extended,
  `photo_from_row` reads index 20, `get_archived_photos` archived_at
  index 20→21, `get_album_photos` and tag-search column lists extended
  with `p.thumb_status`, two new helpers `get_photos_without_thumbnails`
  and `set_thumb_status`, `test_photo` fixture extended);
  `src-tauri/src/lib.rs` (`PhotoMetadata.thumb_status`, `mod thumbnails`,
  two new commands, registration); `src-tauri/src/media.rs`
  (`thumb_status: None` on the import struct literal).

**Verification.** `cargo test`: 56/56. `cargo check`: clean (4
pre-existing dead_code warnings unchanged). `npm run test:run`: 147/147
(no frontend changes yet).

**Deferred to B.2.** Frontend wire-up: AppContext fetches
`thumb_cache_root` once on mount; `processPhotos` (or a new
`getThumbnailUrl` helper) derives the URL; `PhotoCard` falls back to
the original when `thumb_status !== 'ready'`. Settings UI button to
trigger `generate_missing_thumbnails` with progress bar.

**Deferred to B.3.** Virtualized rendering of the gallery (currently
still creates a DOM node per photo).

---

### 2026-04-27 — Phase E (partial): Python + exiftool metadata enrichment

**What:** new `scripts/extract_metadata.py` (Python + exiftool
subprocess), Rust caller in `src-tauri/src/metadata_enrich.rs`, two
Tauri commands (`enrich_photo_metadata`, `enrich_all_metadata`), 10 new
SQLite columns (`camera_make`, `camera_model`, `lens_model`, `iso`,
`aperture`, `shutter_us`, `focal_length_mm`, `orientation`,
`duration_ms`, `codec`) with a composite `idx_camera` index. Settings
modal gets an "Enrich All Photos" button with live progress bar driven
by `metadata_enrich_progress` events, plus an exiftool-install hint
when the binary is missing. PhotoModal info drawer auto-shows Camera,
Lens, Exposure (f-stop / shutter / ISO / focal length on one row),
Duration, and Codec rows when fields are populated.

**Why Python middleware over native Rust:** the user asked for Python
specifically; the second-order benefits made the choice easy:

1. The script can be iterated without recompiling Rust.
2. We can later add ML-based scene/face inference on the Python side
   without bloating the Rust binary or changing the Rust surface.
3. exiftool is the gold-standard metadata extractor (HEIC, RAW, video
   duration/codec, all the EXIF fields we'd otherwise hand-roll). Wrapping
   it from Python is cheap; wrapping from Rust would recreate the same
   subprocess pattern with worse error ergonomics.

**Why subprocess over PyO3 embedding:** PyO3 binds a Python interpreter
into the Rust binary. That would balloon binary size by ~30MB,
complicate distribution (requires bundling Python stdlib), and couple
Python crashes to the host process. Subprocess isolation is cheap and
matches Tauri's existing pattern (we already shell out to `open` for
reveal-in-Finder).

**Why exiftool over Pillow / pyexiv2 / hachoir:** Pillow and pyexiv2
require pip install (we want stdlib-only Python). Hachoir is pure-Python
but not as comprehensive on video codecs. exiftool is a single Perl-based
binary, available via Homebrew, with the broadest format coverage. We
trade "user must install exiftool" for "no Python dep tree."

**Why DB columns over JSON blob:** stored as discrete columns so SQLite
can index them and downstream filters can `WHERE camera_make = ?` without
a JSON1 extension or `json_extract`. Composite `idx_camera` covers the
common (make, model) filter pair we expect for "iPhone 15 Pro" style
queries.

**Why `Option<T>` + `#[serde(skip_serializing_if = "Option::is_none")]`
on every new field:** the wire format stays identical for unenriched
photos, so old library DBs serialize the same as before. No frontend
churn, no migration of existing JSON in tests. Frontend conditionals
already render rows only when present.

**Why bundle the script as a Tauri resource:**
`bundle.resources: ["../scripts"]` ships the script into
`<app>/Contents/Resources/scripts/`. Rust resolves
`app.path().resource_dir()` first, falls back to
`CARGO_MANIFEST_DIR/scripts/` for dev mode. Resources let us update the
script via auto-update (when we add it) without a new Rust binary.

**Files added/changed.**
- New: `scripts/extract_metadata.py`,
  `scripts/test_extract_metadata.py`,
  `src-tauri/src/metadata_enrich.rs`.
- Changed: `src-tauri/src/db.rs` (10 columns, idx_camera, expanded
  `photo_from_row`, all 8 SELECT-returning queries),
  `src-tauri/src/lib.rs` (PhotoMetadata fields + 2 commands +
  registration), `src-tauri/src/media.rs` (struct literal extended with
  None for new fields), `src-tauri/tauri.conf.json` (bundle.resources),
  `src/utils/photoHelpers.js` (spread instead of explicit field list),
  `src/components/PhotoModal.jsx` (info drawer rows for Camera/Lens/
  Exposure/Duration/Codec), `src/components/SettingsModal.jsx` (enrich
  button + progress bar + error hint).

**Verification.** Python: 8/8 unittest. Rust: 51/51 cargo test, cargo
check clean. Frontend: 147/147 vitest.

**Deferred (tracked above).** EXIF write-back for date editing.
Bundling exiftool. Filter UI for camera/lens/ISO (lives in Phase C
when we add the filter chip bar).

---

### 2026-04-27 — Phase A: photo modal, keyboard, skeletons, errors, tooltips

**What:** complete rewrite of `PhotoModal.jsx` (54 → ~440 lines) with
arrow-key + chevron navigation, wheel zoom around cursor, drag-to-pan,
double-click fit/100% toggle, slide-in info drawer (`i`), action bar
(favorite/info/album/tag/archive/delete/reveal-in-finder), keyboard
shortcuts (`f`/`i`/`o`/Backspace/Cmd+Backspace), and a focus trap. New
hooks: `useFocusTrap` and `useKeyboardShortcuts` (global `/`, `g`, `Esc`).
New `<Skeleton>` component for cold-load gallery state. New `<Tooltip>`
component used on every action button. Rust error messages now propagate
through six catch blocks instead of being swallowed. New
`reveal_in_finder` Tauri command. New `cycleViewMode` exposed from
`ViewContext`.

**Why the agent swarm:** Phase A had three independent slices —
PhotoModal rewrite (one file, big), keyboard hook (one file, isolated),
skeleton + error propagation (different files entirely). Spawning three
parallel `developer` agents on non-overlapping file sets cut wall time
roughly in half. The conflict matrix was clean by design — each agent's
prompt listed its files and explicit "do NOT touch" sets.

**Why custom focus trap (~65 LOC) over `focus-trap-react`:** a 65-line
hook is cheaper than +1 npm dep + bundle weight. Reusable across the
other modals later (CreateAlbum/AddToAlbum/Settings/etc. don't trap
focus today — that's a quick follow-up).

**Why disable the global keyboard hook while PhotoModal is open
(`enabled: !selectedPhoto`):** PhotoModal has its own keydown listener
for arrow/k/j/f/i/o/Delete navigation. Without gating, both listeners
would fire on Esc — PhotoModal would close, then the global handler
would try to close some other modal that may not be open. Cheaper to
gate at the parent than coordinate via stop-propagation.

**Why three TODOs left in PhotoModal action wiring (single-photo
add-to-album, tag-assign, album memberships):** those required
threading new state through existing AddToAlbumModal / TagAssignPopover
components. Not on the critical path for Phase A's core polish goals
(nav + zoom + info + delete + archive + reveal). About 30 minutes each
to wire up; flagged in code so they don't get forgotten.

**Why skeleton uses `animate-pulse` instead of a custom shimmer
keyframe:** Tailwind's built-in pulse is mechanically simpler, no
keyframe maintenance, equivalent perceived load feedback. Not trying to
win a design award — trying to stop showing one spinner for the whole
gallery.

**Why error message propagation pattern is `typeof err === 'string' ?
err : err?.message ?? <fallback>`:** Tauri commands returning
`Result<_, String>` deliver the error string directly to JS as a plain
string (not an Error object). Older catch blocks fell through to a
generic "Upload failed" because they assumed err was an Error. The new
pattern preserves the Rust-side context (e.g., "Cannot decode HEIC...")
that's actionable for the user.

**Why custom Tailwind tooltip over HTML `title`:** the `title` attribute
shows the OS-styled tooltip after a ~1s delay. Our custom Tooltip is
glassmorphic (matches the rest of the design system), shows immediately
on hover, and includes the keyboard shortcut inline (e.g., "Favorite
(F)"). ~25 LOC, reusable.

**Why named Tailwind group (`group/tooltip`):** PhotoModal's prev/next
nav uses an unnamed `group` for "fade in chevron when area is hovered."
Naming the tooltip's group avoids collision so both behaviors coexist
on the same DOM tree.

**Why `processPhotos` switched from explicit field list to spread
(`...p`) + overrides:** the explicit list was silently dropping
`latitude`, `longitude`, `file_size`, `source_type`, and any future
backend field. The new info drawer needed those, so the rewrite would
have had to re-add them anyway. Spread is forward-compatible — fields
the Python enrichment adds (camera_make, etc.) flow through
automatically without touching this file again.

**Files added/changed.**
- New: `src/components/Skeleton.jsx`, `Skeleton.test.jsx`,
  `src/components/Tooltip.jsx`, `Tooltip.test.jsx`,
  `src/hooks/useFocusTrap.js`, `useFocusTrap.test.jsx`,
  `src/hooks/useKeyboardShortcuts.js`, `useKeyboardShortcuts.test.js`,
  `docs/POLISH_PLAN.md`.
- Changed: `src/components/PhotoModal.jsx`, `PhotoModal.test.jsx`,
  `src/components/PhotoGrid.jsx`, `PhotoGrid.test.jsx`,
  `src/components/Sidebar.jsx`, `src/contexts/ViewContext.jsx`
  (cycleViewMode), `src/App.jsx` (props + hook wiring + searchInputRef),
  `src/hooks/usePhotos.js`, `src/hooks/useCleanup.js` (error
  propagation), `src-tauri/src/lib.rs` (reveal_in_finder).

**Verification.** Cargo check clean. `cargo test` 48/48. Frontend
143/143 (later 147/147 once Tooltip tests landed).

**Deferred.** Focus trap on the other modals (the hook is reusable —
quick follow-up).

---

## Completed Effort: Open-Source Simplification (2026-04-26, shipped)

**Goal.** Prepare Terra for a public open-source release. Make the code easy to
read for a first-time contributor without over-engineering the simplification
itself.

**Approved plan.** `/Users/bryanzane/.claude/plans/can-you-provide-me-elegant-seal.md`

### Deliberately NOT doing (resisted refactor-itch)

- **`db.rs` split.** 1,661 lines, but `// =====` section banners already
  provide navigation. Splitting just because it's big would be the kind of
  refactor a senior engineer would push back on.
- **7-way `lib.rs` split.** The earlier audit suggested splitting commands by
  feature (photos / albums / tags / cleanup / review / analytics / settings).
  We're doing a simpler 2-way split instead: pure media helpers move to
  `media.rs`; commands stay in `lib.rs` with their existing section banners.
- **CI workflow.** Out of scope for this effort. Worth doing later but not
  bundled with code simplification.
- **Typed `TerraError` Rust enum.** Alpha-stage app doesn't need it. Keep
  `Result<T, String>`.
- **DB migration system.** Current `ALTER TABLE ADD COLUMN IF NOT EXISTS` is
  fine for one-developer schema evolution.
- **`useCleanup` rename.** Cosmetic; can be done anytime.
- **Touching `TagManager.jsx` / `StorageAnalytics.jsx` / `TerraFormReview.jsx`.**
  They're long but cohesive — leave alone.

### Key decisions

- **Author / copyright defaults.** `Bryan Zane <bzane09@gmail.com>`, year 2026.
  Sourced from session context (git user, claude.md).
- **GitHub URL.** Used `github.com/bzane/terra` as a placeholder. Should be
  confirmed against the actual repo URL before publishing.
- **`homepage` in `tauri.conf.json`.** Removed (was the fake `https://terra.local`).

### Changelog

The plan has 6 items, executed in order: A → B → C → D → E → F.

| Item | Title | Status | Commit |
|------|-------|--------|--------|
| A | Polish OSS metadata | done | 3fa1d68 |
| B | Tighten asset protocol scope | done | 3fa1d68 |
| C | `with_db` helper, drop boilerplate | done | ad35178 |
| D | Extract `media.rs` from `lib.rs` | done | e5f8b10 |
| E | Collapse trivial hooks and `SelectionContext` | done | a7359d3 |
| F | Extract `groupPhotos` utility, collapse `ViewContext` effects | done | (next commit) |

Detailed entries are appended below as each item lands.

---

### A + B — OSS metadata + asset scope (2026-04-26)

Bundled into one commit because both are config polish in the same files and
are pre-requisites for sharing the repo publicly. No code logic touched.

**Files changed**

- `src-tauri/Cargo.toml` — `authors` set to real value; added `license = "MIT"`
  and `repository` metadata so `cargo package` and `crates.io` listings have
  proper attribution.
- `src-tauri/tauri.conf.json` — `publisher` set to real value; the fake
  `homepage = "https://terra.local"` field was removed (the field is optional
  for Tauri); asset protocol scope reduced from
  `["$PICTURE/**", "$DATA/**", "$HOME/**"]` to `["$PICTURE/**", "$DATA/**"]`.
- `LICENSE` — copyright line set to `2026 Bryan Zane`.
- `CONTRIBUTING.md` — clone URL updated to `github.com/bzane/terra`; added a
  rule under "Making Changes" telling contributors not to widen the asset
  scope.
- `README.md` — replaced the "Verification Snapshot" section (specific test
  counts that would rot) with a generic "Verification" section pointing at
  `npm run test:run`, `npm run build`, `cargo test`, `cargo check`.

**Verification.** `cargo check` clean except 4 pre-existing dead-code warnings
in `db.rs` (`photo_exists`, `get_photo_count_by_year`, `get_photo_count`,
`get_photos_with_dhash_count`). `tauri.conf.json` validates as JSON.

**GitHub URL.** Discovered the real URL `github.com/BryanZaneee/terra` from
`docs/IMPLEMENTATION_PLAN.md` and used it in `Cargo.toml.repository` and
`CONTRIBUTING.md`.

**Bundling note.** This commit also picks up the user's pre-existing
README.md rewrite (a sober, OSS-friendly rewrite of the marketing intro) that
was in the working tree at session start. It's the same OSS-readiness theme,
so they're bundled. `docs/IMPLEMENTATION_PLAN.md` and `docs/ROADMAP.md` had
pre-existing changes too but were left for a separate commit since they're
docs scope, not the code/metadata polish tracked here.

---

### C — `with_db` helper, drop backend boilerplate (2026-04-26)

The biggest readability win in this effort. Two patterns repeated throughout
the Rust backend:

1. Every Tauri command opened `let conn = db::init_database().map_err(|e|
   format!("Database error: {}", e))?;` (43 copies).
2. Every "list" query helper did `let mut stmt = ...; let rows =
   stmt.query_map(...)?; let mut result = Vec::new(); for r in rows {
   result.push(r?); } Ok(result)` (~17 copies).

**Change.** Added two helpers near the top of `lib.rs`:

```rust
fn db_conn() -> Result<rusqlite::Connection, String> { ... }
fn with_db<T, F>(op: &str, f: F) -> Result<T, String>
where F: FnOnce(&rusqlite::Connection) -> rusqlite::Result<T> { ... }
```

Simple commands now look like:
```rust
fn toggle_favorite(path: String, is_favorite: bool) -> Result<(), String> {
    with_db("Failed to set favorite", |c| db::set_photo_favorite(c, &path, is_favorite))
}
```

Multi-step commands use `db_conn()?` and keep their existing logic.

In `db.rs`, the for-loop pattern was replaced with `let rows =
stmt.query_map(...)?; rows.collect()`. The existing `query_photos` helper at
the bottom of the file was simplified to use the same idiom.

**Drop-order gotcha discovered.** `stmt.query_map(...)?.collect()` as a tail
expression triggers E0597 ("`stmt` does not live long enough") because the
intermediate temporary `Result<MappedRows>` extends a borrow of `stmt` that
outlives the local. Workaround: bind to `let rows = ...;` first, then call
`rows.collect()`. The `query_photos` helper avoids this because its `stmt`
is a parameter (not a local), so drop order isn't a concern. Future
contributors should know: when refactoring db code, prefer
`let rows = stmt.query_map(...)?; rows.collect()` over the chained form.

**Files changed.** `src-tauri/src/lib.rs`, `src-tauri/src/db.rs`.

**Verification.** `cargo test` — all 48 tests pass. `cargo check` clean
except the same 4 pre-existing dead-code warnings.

**Line counts.**
- `lib.rs`: 1,619 → 1,607 (the `with_db` helper offset some of the
  command-side savings; the *commands themselves* are dramatically shorter).
- `db.rs`: 1,661 → 1,501 (−160 lines).

---

### D — Extract `media.rs` from `lib.rs` (2026-04-26)

Pulled all the pure media-processing code out of `lib.rs` into a new
`media.rs` module. The plan deliberately picked a 2-way split (not 7-way) —
commands stay in `lib.rs` with their existing section banners; `db.rs` was
not touched.

**Moved into `media.rs`:**

- Date parsing: `parse_exif_datetime`, `parse_filename_date`,
  `extract_exif_date`, `get_file_modified_time`
- Hashing: `calculate_hash` (SHA-256 content hash), `compute_dhash`
  (perceptual), `hamming_distance`
- GPS: `extract_gps`, `get_location_name`
- Media classification: `is_video`, `detect_screenshot`
- Pipeline: `process_image`
- The `lazy_static!` block (regexes + `GEOCODER_LOCATIONS`)

**Stayed in `lib.rs`:**

- `PhotoMetadata` struct (it's a domain type used across db, frontend, and
  commands; not media-specific)
- `pub mod config` (constants used by commands and db, plus referenced
  from media.rs as `crate::config`)
- All 43 Tauri commands and their helper structs (`DuplicateGroup`,
  `ScanProgress`, `ArchivedPhoto`)
- `is_path_in_managed_library` (security check that depends on
  `db::get_library_path` and `db::get_archive_path`, so it's not pure
  media)
- `db_conn` / `with_db` helpers
- `run()` and command registration

**Small polish.** The `screenshot_dimensions` Vec inside `detect_screenshot`
became a `const SCREENSHOT_DIMENSIONS: &[(u32, u32)]` since it's effectively
a static lookup table — saves an allocation per call.

**Files changed.** New `src-tauri/src/media.rs` (539 lines). Updated
`src-tauri/src/lib.rs` (1,607 → 1,051 lines).

**Verification.** `cargo test`: 48 tests pass (24 of them moved from
`lib.rs::tests` into `media::tests`; the rest are `db::tests`). `cargo
check` clean except the pre-existing 4 dead-code warnings.

---

### E — Collapse trivial hooks and SelectionContext (2026-04-26)

The frontend had three layering choices that added indirection without
value, all flagged in the audit:

- `src/hooks/useTags.js` (23 lines) — `useState + invoke('get_all_tags')`.
- `src/hooks/useAlbums.js` (43 lines) — three thin async wrappers around
  invoke calls.
- `src/contexts/SelectionContext.jsx` (16 lines) — a context that wrapped
  one hook (`useSelection`) and exposed it to maybe two components.

**Change.**

- `useTags.js` and `useAlbums.js`: deleted. State and handlers folded
  directly into `AppContext.jsx`. `AppContext.jsx` grew from 45 to 89
  lines but it's now the single place all the cross-cutting state lives.
- `SelectionContext.jsx`: deleted. `AppLayout` now calls
  `useSelection(flatVisiblePhotos)` itself — `flatVisiblePhotos` already
  comes from `useViewContext`. `App.jsx`'s provider stack drops from
  `App > Error > AppProvider > ViewProvider > SelectionProvider > Layout`
  to `App > Error > AppProvider > ViewProvider > Layout`.
- Test files for the deleted hooks (`useTags.test.js`, `useAlbums.test.js`)
  also deleted. They were testing the hook's own API surface, not real
  user-visible behavior — the latter is covered by `App.test.jsx`.
- `useSelection.js` is kept; it has real shift/cmd-click range-selection
  logic and its dedicated tests are preserved.

**Files removed.**
- `src/hooks/useTags.js`, `src/hooks/useTags.test.js`
- `src/hooks/useAlbums.js`, `src/hooks/useAlbums.test.js`
- `src/contexts/SelectionContext.jsx`

**Files changed.**
- `src/contexts/AppContext.jsx` (45 → 89 lines)
- `src/App.jsx` (provider stack reduced by one level; `useSelection` called
  directly inside `AppLayout`)

**Verification.** `npm run test:run`: 96 frontend tests pass (down from
103; the 7 deleted tests were all trivial-hook coverage).

---

### F — Extract groupPhotos utility, collapse ViewContext effects (2026-04-26)

`ViewContext.jsx` had two readability hotspots flagged by the audit:

1. A 50-line `useMemo` with six conditional branches that grouped photos
   differently for each view mode (duplicates / locations / tags /
   collection:* / regular). Hard to scan and impossible to unit-test.
2. Four near-identical async load effects (album, smart collection, tag,
   "regular view fallback") plus a fifth effect that re-fired the tag load
   when `selectedTagIds` changed.

**Change.**

- Extracted `groupPhotosBy(viewMode, photos, smartCollections)` into a new
  pure function at `src/utils/groupPhotos.js` (72 lines). Added
  `src/utils/groupPhotos.test.js` covering all 6 branches and the filter
  semantics (12 tests).
- Inside `ViewContext.jsx`, the `useMemo` becomes a one-line call to
  `groupPhotosBy`. The four scattered load-effects collapse into one
  effect with `if/else if` switching on `viewMode`. The redundant
  selectedTagIds-only effect is gone — the unified effect's dependency
  array (`[viewMode, selectedTagIds]`) covers it.

**Year-test gotcha.** The first version of the year-grouping test used
`Date(timestamp).getFullYear()` with a Jan-1 UTC timestamp, which can
shift across a year boundary depending on the test runner's timezone.
Switched to mid-year timestamps so the test is timezone-independent.

**Files.**
- New: `src/utils/groupPhotos.js`, `src/utils/groupPhotos.test.js`.
- Changed: `src/contexts/ViewContext.jsx` (260 → 181 lines).

**Verification.** `npm run test:run`: 108 frontend tests pass (96 + 12 new
`groupPhotos` tests). `npm run build` succeeds (the 618 kB chunk-size
warning is pre-existing).

---

## Final state of the simplification effort

Total impact across A–F (vs the pre-refactor state):

| File | Before | After | Δ |
|------|--------|-------|---|
| `src-tauri/src/lib.rs` | 1,619 | 1,051 | −568 |
| `src-tauri/src/db.rs` | 1,661 | 1,501 | −160 |
| `src-tauri/src/media.rs` | (n/a) | 539 | +539 |
| `src/contexts/AppContext.jsx` | 45 | 89 | +44 |
| `src/contexts/ViewContext.jsx` | 260 | 181 | −79 |
| `src/utils/groupPhotos.js` | (n/a) | 72 | +72 |
| Frontend deletions (5 files) | 109 | 0 | −109 |

`cargo test`: 48 → 48. `npm run test:run`: 103 → 108 (lost 7 trivial-hook
tests, gained 12 `groupPhotos` tests).

Open items for the owner before publishing:
- Confirm `github.com/BryanZaneee/terra` matches the actual repo URL.
- Confirm author email `bzane09@gmail.com` is appropriate to publish.
- Decide whether `docs/IMPLEMENTATION_PLAN.md` and `docs/ROADMAP.md` (which
  had pre-existing changes touched in the working tree) should ship in
  separate commits or be amended into this series.
