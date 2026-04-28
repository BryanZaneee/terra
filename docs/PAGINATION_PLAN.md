# Pagination Plan

Future-proofing the photo library data flow for 50k–100k+ photos. Replaces the current "load entire library into one JS array" model with cursor-paginated server-side queries.

This plan is iterative — phase boundaries are deliberately small so we can ship and validate each step before the next.

## 1. Goals

- First paint independent of library size (target: <100ms even at 100k photos).
- Memory bounded — only the visible window plus a buffer in JS at any time.
- All current features keep working: view modes, filters, tags, search, smart collections, sidebar counts.
- Cursor-based, mutation-resilient (deletes/inserts mid-scroll do not break the next page).

## 2. Core design decisions

**Cursor-based, not OFFSET.** `OFFSET 50000 LIMIT 200` makes SQLite scan all 50k preceding rows. Cursor on `(date_taken, id)` jumps directly via index — O(log n) per page. The composite tuple handles ties on `date_taken`.

**Page size: 200.** ~4 screens at typical column counts; tunable in `src/config.js`.

**One backend command for all views.** Instead of `get_favorites_page`, `get_archived_page`, etc., a single `get_photos_page(filter, cursor, limit)` command. The filter enum carries view semantics; the SQL builder branches on it.

**Server-side filtering.** All current client-side filtering (favorites, search by name/location, archived, unreviewed, tag-match) moves into the SQL builder. Otherwise pagination is broken — you cannot filter "favorites in this loaded chunk" and call it done.

**Counts as a separate cheap call.** Sidebar needs totals (e.g. `All Photos · 12,304`). One `get_view_counts() -> Counts {...}` query, called on mount and after mutations.

## 3. New types & API surface

```rust
// src-tauri/src/lib.rs

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ViewFilter {
    All,
    Favorites,
    Archived,
    Unreviewed,
    PhotosOnly,
    VideosOnly,
    Tag { id: i64 },
    Album { id: i64 },
    Location { name: String },
    SmartCollection { id: String },
    Search { query: String },
}

#[derive(Serialize, Deserialize, Clone)]
struct Cursor { date_taken: i64, id: i64 }

#[derive(Serialize)]
struct PageResult {
    photos: Vec<PhotoMetadata>,
    next_cursor: Option<Cursor>,
}

#[tauri::command]
fn get_photos_page(filter: ViewFilter, cursor: Option<Cursor>, limit: i64) -> Result<PageResult, String>;

#[tauri::command]
fn get_view_counts() -> Result<HashMap<String, i64>, String>;
```

## 4. SQL strategy

Base WHERE clause from `ViewFilter`, then append cursor and ordering:

```sql
SELECT … FROM photos
WHERE <filter clause>
  AND (date_taken < :cur_date OR (date_taken = :cur_date AND id < :cur_id))   -- if cursor
ORDER BY date_taken DESC, id DESC
LIMIT :limit + 1   -- fetch one extra to know if there's a next page
```

If `limit + 1` rows come back, the last row's `(date_taken, id)` becomes `next_cursor`; otherwise `next_cursor = None`. Avoids an extra `COUNT` round-trip per page.

Add composite index `idx_date_id ON photos(date_taken DESC, id DESC)` for the cursor walk.

## 5. Phased rollout

### Phase P.1 — Backend foundation, no UI changes

- Add `Cursor`, `ViewFilter`, `PageResult` in `lib.rs`.
- Implement `get_photos_page` for `ViewFilter::All` only.
- Implement `get_view_counts`.
- Add composite index `idx_date_id` (gated by `PRAGMA user_version` bump).
- Tests in `db.rs`: empty library, single page, multi-page walk, cursor at exact tie on `date_taken`, last-page-empty-cursor sentinel.

### Phase P.2 — Frontend hook, single view

- New `src/hooks/usePagedPhotos.js`: holds `photos`, `nextCursor`, `loadingPage`, `error`; exposes `loadNextPage()` and `reset(filter)`.
- Wire `react-virtuoso`'s `endReached` callback in `PhotoGrid.jsx`.
- Replace `useAppContext`'s `loadPhotosFromDatabase` for the All-Photos view only.
- Behind `CONFIG.USE_PAGINATION` flag so we can flip back.

### Phase P.3 — All view modes

- Extend `ViewFilter` SQL to handle `Favorites`, `Archived`, `Unreviewed`, `PhotosOnly`, `VideosOnly`.
- `useViewContext` derives `ViewFilter` from `viewMode` and resets the paged hook on change.

### Phase P.4 — Tags, location, album, search, smart collection

- Each becomes a `ViewFilter` variant with its SQL clause.
- Move client-side search (currently substring on name/location) to `LIKE %?%`.
- Refactor `get_album_photos` and `get_smart_collection_photos` to share the same paginated path.

### Phase P.5 — Counts + sidebar wiring

- `get_view_counts` returns `{ all, favorites, archived, unreviewed, photos_only, videos_only, by_album: Map, by_tag: Map, by_smart_collection: Map }`.
- Cache in context, refresh after upload/archive/delete/keep mutations.
- Sidebar reads from cache instead of `photos.length`.

### Phase P.6 — Cleanup

- Remove `get_all_photos`, other legacy non-paginated commands, and the feature flag.
- Document the new data flow in `docs/IMPLEMENTATION_PLAN.md`.

## 6. Mutations & invariants

- **Optimistic remove**: archive/delete/keep splices the photo out of the in-memory page array immediately; no re-fetch.
- **Cursor robustness**: cursor is `(date_taken, id)` *values*, not row positions, so deletes between page fetches do not skip rows.
- **Insert during scroll**: a new upload's `date_taken` is recent and lands at top of the list. Already-loaded pages do not show it until the user scrolls back to top and resets. Acceptable.
- **Counts staleness**: refresh `get_view_counts` after every mutation that changes a count. One query, roughly 1ms.

## 7. Out of scope (intentional)

Flagged for follow-up so we do not scope-creep:

- **Select-all across pages.** Current `useSelection` set tracks loaded paths only; "select all" today selects only what is loaded. Future: a `select_all_paths(filter)` command returning the full path list for a filter.
- **Scroll restoration after closing a modal.** Virtuoso supports `restoreStateFrom`. Wire later.
- **Background prefetch of next page** (could halve perceived scroll latency; measure first).
- **Window eviction** (drop pages far above the viewport from memory) — only worth it at 200k+ photos.
- **True full-text search (FTS5).** Substring `LIKE` is fine until users complain.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Off-by-one in cursor (skipped or duplicated rows) | `LIMIT n+1` sentinel design + Phase P.1 tests with ties on `date_taken`. |
| Virtuoso `endReached` fires repeatedly during fast scroll | Guard with `if (loadingPage \|\| !nextCursor) return` in the hook. |
| Search latency at 100k rows with `LIKE %q%` | Add `LOWER(name)` index; if still slow, FTS5 virtual table in a follow-up. |
| Smart collections lose count cards | Counts come from `get_view_counts`, computed by index-friendly `COUNT(*)` queries. |
| Config-flag rollback after shipping | Flag stays only through P.2–P.4 with both code paths working; removed in P.6. |

## 9. Estimated diff size

- Phase P.1: ~250 LOC Rust + tests.
- Phase P.2: ~150 LOC JS + Virtuoso wiring.
- Phase P.3–P.4: ~300 LOC SQL clauses + filter migration.
- Phase P.5: ~100 LOC counts wiring.
- Phase P.6: net negative (deletes legacy code).

**Total: ~800 LOC added, ~200 LOC removed.** Roughly twice the size of all the cold-start perf work combined.
