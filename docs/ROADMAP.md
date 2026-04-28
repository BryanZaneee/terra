# Terra Roadmap

This roadmap captures the next planned sequence after the current local-library foundation. It is intentionally high level; each item should receive its own implementation plan before coding begins.

## 1. Thumbnail Generation and Virtualized Gallery Rendering

Goal: make large libraries feel fast and predictable.

- Generate local thumbnails for imported photos and videos.
- Store thumbnail paths or cache keys in SQLite.
- Use thumbnails in gallery cards and preserve originals for modal/full-size viewing.
- Add virtualized rendering so large views do not create thousands of DOM nodes at once.
- Keep grouping behavior for years, months, albums, tags, and smart collections.

Success criteria:

- Smooth scrolling with large libraries.
- Lower memory use compared with rendering original files in every grid card.
- No loss of existing selection, grouping, favorite, tag, modal, or cleanup behavior.

## 2. Generic Import Job System

Goal: create one durable pipeline that all cloud/social import sources can use.

- Add import jobs with source type, status, progress, counts, errors, and timestamps.
- Support dry-run/preflight summaries before copying files.
- Reuse existing metadata extraction, hashing, dedupe, and managed-library copy behavior.
- Expose progress to the frontend through Tauri events.
- Show active and completed import jobs in the UI.

Success criteria:

- Importers share one consistent workflow.
- Failed imports can report actionable errors.
- The app can distinguish skipped duplicates, imported files, unsupported files, and failed files.

## 3. Google Photos Takeout Import

Goal: provide the first practical cloud-migration path without requiring OAuth.

- Import from a Google Takeout folder or ZIP export.
- Detect media files and associated JSON sidecar metadata.
- Preserve meaningful dates, album/folder context, filenames, and source attribution where available.
- Route all copied media through the generic import job system.

Success criteria:

- A local Takeout export can be imported without network access.
- Duplicate handling uses existing content hash behavior.
- Import summaries clearly report imported, skipped, unsupported, and failed items.

## 4. Apple Photos and iCloud Import Path

Goal: help users bring Apple Photos/iCloud libraries into Terra while respecting local-first constraints.

- Prefer local imports from Photos.app exports or local iCloud Photos folders before considering any network flow.
- Support user-selected export folders with original media and metadata sidecars when available.
- Investigate whether AppleScript or macOS Photos automation can provide a safe optional helper flow.
- Reuse the generic import job system.

Success criteria:

- Users have a documented, reliable Apple Photos export-to-Terra path.
- The implementation avoids brittle or unofficial iCloud scraping.
- Imported media behaves like normal Terra library media after ingestion.

## 5. Snapchat and Social Archive Imports

Goal: handle social-media archive exports after the general importer is proven.

- Start with local archive folders or ZIP files.
- Identify media directories and metadata files for each supported source.
- Preserve source attribution and best-effort capture dates.
- Reuse the generic import job system and reporting.

Success criteria:

- Terra can ingest at least one Snapchat/social archive format from local files.
- Unsupported archive layouts fail with clear messaging.
- New source handlers can be added without rewriting the core import pipeline.

## Cross-Cutting Follow-Ups

- Update docs after each roadmap item ships.
- Add tests around import parsing, duplicate handling, and failure reporting.
- Keep existing filesystem deletion safeguards intact.
- Keep all cloud/social import paths local-first unless a later plan explicitly introduces OAuth or network sync.
