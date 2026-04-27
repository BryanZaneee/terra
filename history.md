# Terra Refactor History

This file is maintained for future agents working on Terra. It records what
changed and *why*, especially decisions that aren't obvious from the diff.

## Active Effort: Open-Source Simplification (started 2026-04-26)

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
| D | Extract `media.rs` from `lib.rs` | done | (next commit) |
| E | Collapse trivial hooks and `SelectionContext` | pending | — |
| F | Extract `groupPhotos` utility, collapse `ViewContext` effects | pending | — |

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
