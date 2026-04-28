# Terra Roadmap

This roadmap captures the next planned sequence after the current local-library foundation. It is intentionally high level; each item should receive its own implementation plan before coding begins.

## 1. Scale: Thumbnails, Virtualization, and Pagination

Goal: make large libraries feel fast and predictable.

Current v1:

- Generated photo thumbnails and content-addressed cache paths exist.
- Gallery rendering uses `react-virtuoso`.
- Cursor pagination backend and a feature-flagged All Photos frontend path exist.

Next:

- Generate thumbnails for videos.
- Finish cursor pagination for filtered views, albums, tags, search, and smart collections.
- Validate performance with a real 50k-100k item library.

Success criteria:

- Smooth scrolling with large libraries.
- Lower memory use compared with rendering original files in every grid card.
- No loss of existing selection, grouping, favorite, tag, modal, or cleanup behavior.

## 2. Generic Import Job System

Goal: create one durable pipeline that all cloud/social import sources can use.

Current v1:

- Provider import summaries include source, discovered, imported, duplicate, unsupported, and failed counts.
- Provider imports reuse metadata extraction, hashing, dedupe, and managed-library copy behavior.
- Provider import progress emits through Tauri events.

Next:

- Add persisted import jobs with status, progress, errors, timestamps, and per-item records.
- Support dry-run/preflight summaries before copying files.
- Show active and completed import jobs in the UI.

Success criteria:

- Importers share one consistent workflow.
- Failed imports can report actionable errors.
- The app can distinguish skipped duplicates, imported files, unsupported files, and failed files.

## 3. Google Photos Takeout Import

Goal: provide the first practical cloud-migration path without requiring OAuth.

Current v1:

- Import from a Google Takeout folder or ZIP export.
- Route copied media through the shared provider export importer.
- Report imported, duplicate, unsupported, and failed counts.

Next:

- Detect media files and associated JSON sidecar metadata.
- Preserve meaningful dates, album/folder context, filenames, and source attribution where available.

Success criteria:

- A local Takeout export can be imported without network access.
- Duplicate handling uses existing content hash behavior.
- Import summaries clearly report imported, skipped, unsupported, and failed items.

## 4. Apple Photos and iCloud Import Path

Goal: help users bring Apple Photos/iCloud libraries into Terra while respecting local-first constraints.

Current v1:

- Support user-selected Apple/iCloud export folders and ZIP archives.
- Give official Apple download links in the import wizard.
- Avoid brittle or unofficial iCloud scraping.

Next:

- Support Apple export sidecars where available.
- Investigate whether AppleScript, PhotoKit, or macOS Photos automation can provide a safe optional helper flow.

Success criteria:

- Users have a documented, reliable Apple Photos export-to-Terra path.
- The implementation avoids brittle or unofficial iCloud scraping.
- Imported media behaves like normal Terra library media after ingestion.

## 5. Snapchat and Social Archive Imports

Goal: handle social-media archive exports after the general importer is proven.

Current v1:

- Start with local archive folders or ZIP files.
- Import supported media from Snapchat exports through the shared provider importer.
- Report imported, duplicate, unsupported, and failed counts.

Next:

- Identify source-specific media directories and metadata files for Snapchat and later social archives.
- Preserve source attribution and best-effort capture dates from archive metadata.

Success criteria:

- Terra can ingest at least one Snapchat/social archive format from local files.
- Unsupported archive layouts fail with clear messaging.
- New source handlers can be added without rewriting the core import pipeline.

## Cross-Cutting Follow-Ups

- Update docs after each roadmap item ships.
- Add tests around import parsing, duplicate handling, and failure reporting.
- Keep existing filesystem deletion safeguards intact.
- Keep all cloud/social import paths local-first unless a later plan explicitly introduces OAuth or network sync.
