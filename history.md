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
| A | Polish OSS metadata | done | (next commit) |
| B | Tighten asset protocol scope | done | (next commit) |
| C | `with_db` helper, drop boilerplate | pending | — |
| D | Extract `media.rs` from `lib.rs` | pending | — |
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
