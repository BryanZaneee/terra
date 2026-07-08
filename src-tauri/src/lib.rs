use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use rayon::prelude::*;
use reverse_geocoder::ReverseGeocoder;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use log::{debug, error, info, warn};

mod db;
mod imports;
mod media;
mod metadata_enrich;
mod thumbnails;

use imports::{collect_export_media, ImportProvider};
use media::{compute_dhash, detect_screenshot, hamming_distance, process_image, GEOCODER_LOCATIONS};
use metadata_enrich::enrich_path;

/// Application configuration constants
pub mod config {
    /// Number of days before archived photos are permanently deleted
    pub const ARCHIVE_DELETION_DAYS: i64 = 14;

    /// Hamming distance threshold for perceptual hash duplicate detection.
    /// Lower values = stricter matching (fewer false positives).
    /// Range: 0-64 where 0 is exact match, 10 is default for "similar" photos.
    pub const DUPLICATE_HAMMING_THRESHOLD: u32 = 10;

    /// Minimum valid year for date parsing (Unix epoch start)
    pub const MIN_VALID_YEAR: i32 = 1970;

    /// Maximum valid year for date parsing (reasonable future bound)
    pub const MAX_VALID_YEAR: i32 = 2100;
}

/// Process-wide SQLite handle. SQLite serializes writes anyway and our query
/// surface is small, so funneling every command through one Mutex-guarded
/// connection avoids the per-call open + WAL-pragma + schema-check tax that
/// `init_database()` used to pay every time. The first call initializes
/// (open file, apply pragmas, run migrations); subsequent calls just lock.
static DB: OnceLock<Mutex<rusqlite::Connection>> = OnceLock::new();

/// Acquire the shared SQLite connection. Errors only on a poisoned mutex,
/// which would mean a prior command panicked mid-transaction — fatal anyway.
/// The MutexGuard derefs to `&Connection`, so callers can keep using
/// `db::function(&conn, ...)` without changes.
fn db_conn() -> Result<MutexGuard<'static, rusqlite::Connection>, String> {
    let mutex = DB.get_or_init(|| {
        Mutex::new(db::init_database().expect("Failed to initialize database"))
    });
    mutex.lock().map_err(|e| format!("DB mutex poisoned: {}", e))
}

/// Open a connection, run one db operation, and format any error.
/// Use for one-shot commands; multi-step commands should call `db_conn()`.
fn with_db<T, F>(op: &str, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> rusqlite::Result<T>,
{
    let conn = db_conn()?;
    f(&conn).map_err(|e| format!("{}: {}", op, e))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PhotoMetadata {
    pub path: String,
    pub name: String,
    pub date_taken: i64, // Unix timestamp
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub is_favorite: bool,
    pub content_hash: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub location_name: Option<String>,
    // Enriched camera/lens metadata (populated by enrich_photo_metadata)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iso: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aperture: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutter_us: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<i32>,
    // Enriched video metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    /// 'ready' = on-disk thumb at the canonical content-addressed path;
    /// 'failed' = decoder rejected (e.g. unsupported HEIC); 'unsupported' = video.
    /// None means we haven't tried yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_status: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ProviderImportSummary {
    pub provider_id: String,
    pub provider_label: String,
    pub discovered: usize,
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub unsupported: usize,
    pub failed: usize,
    pub imported_photos: Vec<PhotoMetadata>,
}

#[derive(Serialize, Clone)]
pub struct ProviderImportProgress {
    pub provider_id: String,
    pub provider_label: String,
    pub total: usize,
    pub processed: usize,
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub failed: usize,
    pub phase: String,
}

// ============================================================================
// Pagination types (PAGINATION_PLAN.md)
// ============================================================================

/// Discriminates which slice of the library a page query targets.
/// SQL builder in db::get_photos_page branches on this.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewFilter {
    All,
    Favorites,
    Archived,
    Unreviewed,
    PhotosOnly,
    VideosOnly,
    /// One or more tags. `match_all: true` requires every tag; false matches any (OR).
    Tags {
        ids: Vec<i64>,
        #[serde(default)]
        match_all: bool,
    },
    Album { id: i64 },
    Location { name: String },
    Search { query: String },
    /// Smart collection by id (e.g. "size_large", "time_7days"). The
    /// paginated path overrides the legacy file-size ordering with the
    /// uniform `date_taken DESC, id DESC` walk so the cursor stays valid;
    /// users can still see large/old/etc. content via the WHERE clause.
    SmartCollection { id: String },
}

/// Cursor onto a row, by `(date_taken, id)`. Carrying both makes the walk
/// stable even when many rows share a `date_taken`. Cursors are exclusive:
/// the next page is strictly less than this position in DESC order.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Cursor {
    pub date_taken: i64,
    pub id: i64,
}

#[derive(Serialize, Debug)]
pub struct PageResult {
    pub photos: Vec<PhotoMetadata>,
    pub next_cursor: Option<Cursor>,
}

/// Sidebar count cache (PAGINATION_PLAN.md, P.5).
///
/// In paginated mode the frontend can't use `photos.length` for sidebar
/// badges any more — only the loaded window is in memory. This struct holds
/// the COUNT(*) of every counted slice so the sidebar shows the true total.
///
/// `by_album`/`by_tag`/`by_smart_collection` use `String` keys because JSON
/// object keys are strings on the wire and React iteration is simpler that
/// way. The existing `get_albums`/`get_all_tags` fetchers continue to
/// populate the per-row count fields they always have — these maps are an
/// additional, single-call lookup for callers that just need totals.
#[derive(Serialize, Debug, Default)]
pub struct ViewCounts {
    pub all: i64,
    pub favorites: i64,
    pub archived: i64,
    pub unreviewed: i64,
    pub photos_only: i64,
    pub videos_only: i64,
    pub by_album: HashMap<String, i64>,
    pub by_tag: HashMap<String, i64>,
    pub by_smart_collection: HashMap<String, i64>,
}

/// COMMAND: Upload Photos
/// Copies photos to the Terra managed library and saves metadata to database
#[tauri::command]
fn upload_photos(file_paths: Vec<String>) -> Result<Vec<PhotoMetadata>, String> {
    info!("Uploading {} photos", file_paths.len());

    let paths = file_paths.into_iter().map(PathBuf::from).collect();
    let summary = import_media_paths(
        paths,
        "upload",
        "Upload Photos",
        "upload",
        0,
        None,
    )?;

    info!("Successfully uploaded {} photos", summary.imported);
    Ok(summary.imported_photos)
}

/// COMMAND: Import a downloaded provider export folder or ZIP.
#[tauri::command]
async fn import_provider_export(
    window: tauri::Window,
    provider_id: String,
    source_path: String,
) -> Result<ProviderImportSummary, String> {
    let provider = ImportProvider::from_id(&provider_id)?;
    let source = PathBuf::from(&source_path);

    info!(
        "Importing {} export from {}",
        provider.label(),
        source.display()
    );

    let collection = collect_export_media(provider, &source)?;
    let staging_dir = collection.staging_dir.clone();

    let _ = window.emit(
        "provider_import_progress",
        ProviderImportProgress {
            provider_id: provider.id().to_string(),
            provider_label: provider.label().to_string(),
            total: collection.media_paths.len(),
            processed: 0,
            imported: 0,
            skipped_duplicates: 0,
            failed: 0,
            phase: "copying".to_string(),
        },
    );

    let summary = import_media_paths(
        collection.media_paths,
        provider.id(),
        provider.label(),
        provider.id(),
        collection.unsupported_count,
        Some(&window),
    )?;

    if let Some(staging_dir) = staging_dir {
        if let Err(err) = fs::remove_dir_all(&staging_dir) {
            warn!(
                "Failed to clean import staging folder {}: {}",
                staging_dir.display(),
                err
            );
        }
    }

    Ok(summary)
}

fn import_media_paths(
    file_paths: Vec<PathBuf>,
    provider_id: &str,
    provider_label: &str,
    source_type: &str,
    unsupported_count: usize,
    progress_window: Option<&tauri::Window>,
) -> Result<ProviderImportSummary, String> {
    let library_path = db::get_library_path();
    let conn = db_conn()?;
    // One transaction for the whole import: per-row implicit commits dominate
    // import time on large batches.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start import transaction: {}", e))?;

    // Use cached geocoder locations for better performance
    let geocoder = ReverseGeocoder::new(&GEOCODER_LOCATIONS);

    let total = file_paths.len();
    let mut summary = ProviderImportSummary {
        provider_id: provider_id.to_string(),
        provider_label: provider_label.to_string(),
        discovered: total,
        imported: 0,
        skipped_duplicates: 0,
        unsupported: unsupported_count,
        failed: 0,
        imported_photos: Vec::new(),
    };

    for (index, source_path) in file_paths.iter().enumerate() {
        if !source_path.exists() {
            warn!("File not found during import: {}", source_path.display());
            summary.failed += 1;
            emit_import_progress(progress_window, &summary, total, index + 1, "copying");
            continue;
        }

        if !imports::is_supported_media_path(source_path) {
            summary.unsupported += 1;
            emit_import_progress(progress_window, &summary, total, index + 1, "copying");
            continue;
        }

        let mut photo = match process_image(source_path, Some(&geocoder)) {
            Some(photo) => photo,
            None => {
                warn!("Failed to process import media: {}", source_path.display());
                summary.failed += 1;
                emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                continue;
            }
        };

        if let Some(hash) = &photo.content_hash {
            match db::hash_exists(&conn, hash) {
                Ok(true) => {
                    debug!("Skipping duplicate import: {} (hash: {})", photo.name, hash);
                    summary.skipped_duplicates += 1;
                    emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                    continue;
                }
                Ok(false) => {}
                Err(e) => warn!("Failed to check hash existence: {}", e),
            }
        }

        let date = match chrono::DateTime::from_timestamp(photo.date_taken, 0) {
            Some(date) => date,
            None => {
                warn!(
                    "Invalid import timestamp for {}: {}",
                    source_path.display(),
                    photo.date_taken
                );
                summary.failed += 1;
                emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                continue;
            }
        };
        let year = date.format("%Y").to_string();
        let month = date.format("%m").to_string();

        let mut dest_dir = library_path.clone();
        dest_dir.push(&year);
        dest_dir.push(&month);

        if let Err(err) = fs::create_dir_all(&dest_dir) {
            error!("Failed to create import destination {}: {}", dest_dir.display(), err);
            summary.failed += 1;
            emit_import_progress(progress_window, &summary, total, index + 1, "copying");
            continue;
        }

        let file_name = match source_path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                summary.failed += 1;
                emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                continue;
            }
        };
        let mut dest_path = dest_dir;
        dest_path.push(&file_name);

        let mut final_dest_path = dest_path.clone();
        let mut counter = 1;
        while final_dest_path.exists() {
            let stem = match source_path.file_stem() {
                Some(stem) => stem.to_string_lossy(),
                None => break,
            };
            let ext = match source_path.extension() {
                Some(ext) => ext.to_string_lossy(),
                None => break,
            };
            final_dest_path = dest_path.with_file_name(format!("{}_{}.{}", stem, counter, ext));
            counter += 1;
        }

        match fs::copy(source_path, &final_dest_path) {
            Ok(_) => debug!(
                "Copied {} to {}",
                source_path.display(),
                final_dest_path.display()
            ),
            Err(e) => {
                error!("Failed to copy {}: {}", source_path.display(), e);
                summary.failed += 1;
                emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                continue;
            }
        }

        let canonical_dest = match final_dest_path.canonicalize() {
            Ok(p) => {
                debug!("Canonicalized destination: {}", p.display());
                p.to_string_lossy().to_string()
            }
            Err(e) => {
                warn!("Could not canonicalize destination {:?}: {}", final_dest_path, e);
                final_dest_path.to_string_lossy().to_string()
            }
        };

        photo.path = canonical_dest.clone();
        photo.name = match final_dest_path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => file_name,
        };

        match db::insert_photo(&conn, &photo, source_type) {
            Ok(_) => debug!("Saved imported media to database: {}", photo.name),
            Err(e) => {
                error!("Failed to save {} to database: {}", photo.name, e);
                summary.failed += 1;
                emit_import_progress(progress_window, &summary, total, index + 1, "copying");
                continue;
            }
        }

        if let Ok(metadata) = fs::metadata(&final_dest_path) {
            let _ = db::update_photo_file_size(&conn, &photo.path, metadata.len() as i64);
        }

        if let Some(dhash) = compute_dhash(&final_dest_path) {
            let _ = db::update_photo_dhash(&conn, &photo.path, dhash as i64);
            debug!("Computed dhash for {}: {}", photo.name, dhash);
        }

        let is_screenshot = detect_screenshot(&photo.name, photo.width, photo.height);
        if is_screenshot {
            let _ = db::update_photo_screenshot_flag(&conn, &photo.path, true);
            debug!("Detected screenshot: {}", photo.name);
        }

        debug!(
            "Successfully imported: {} -> {}",
            source_path.display(),
            photo.path
        );
        summary.imported += 1;
        summary.imported_photos.push(photo);
        emit_import_progress(progress_window, &summary, total, index + 1, "copying");
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit import transaction: {}", e))?;
    emit_import_progress(progress_window, &summary, total, total, "complete");
    Ok(summary)
}

fn emit_import_progress(
    window: Option<&tauri::Window>,
    summary: &ProviderImportSummary,
    total: usize,
    processed: usize,
    phase: &str,
) {
    if let Some(window) = window {
        if processed % 10 == 0 || processed == total || phase == "complete" {
            let _ = window.emit(
                "provider_import_progress",
                ProviderImportProgress {
                    provider_id: summary.provider_id.clone(),
                    provider_label: summary.provider_label.clone(),
                    total,
                    processed,
                    imported: summary.imported,
                    skipped_duplicates: summary.skipped_duplicates,
                    failed: summary.failed,
                    phase: phase.to_string(),
                },
            );
        }
    }
}

#[tauri::command]
fn toggle_favorite(path: String, is_favorite: bool) -> Result<(), String> {
    with_db("Failed to set favorite", |c| db::set_photo_favorite(c, &path, is_favorite))
}

#[tauri::command]
fn create_album(name: String) -> Result<i64, String> {
    with_db("Failed to create album", |c| db::create_album(c, &name))
}

#[tauri::command]
fn get_albums() -> Result<Vec<db::Album>, String> {
    with_db("Failed to get albums", |c| db::get_albums(c))
}

#[tauri::command]
fn add_to_album(album_id: i64, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for path in photo_paths {
        db::add_photo_to_album(&conn, album_id, &path).map_err(|e| format!("Failed to add to album: {}", e))?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Check if a path is within the Terra managed library or archive directories.
/// This is a security check to prevent deletion of files outside the managed library.
fn is_path_in_managed_library(path: &Path) -> bool {
    let library_path = db::get_library_path();
    let archive_path = db::get_archive_path();

    // Canonicalize paths for reliable comparison
    let canonical_path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    let canonical_library = match library_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    let canonical_archive = match archive_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    canonical_path.starts_with(&canonical_library) || canonical_path.starts_with(&canonical_archive)
}

#[tauri::command]
fn delete_photos(paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    for path_str in paths {
        // 1. Delete from database
        db::delete_photo(&conn, &path_str).map_err(|e| format!("Failed to delete from DB: {}", e))?;

        // 2. Delete from filesystem ONLY if it's in the managed library
        let path = Path::new(&path_str);
        if path.exists() {
            // Safety check: only delete files within Terra's managed directories
            if is_path_in_managed_library(path) {
                fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))?;
            } else {
                warn!("Skipping filesystem deletion for path outside managed library: {}", path_str);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn get_locations() -> Result<Vec<(String, i64)>, String> {
    with_db("Failed to get locations", |c| db::get_locations(c))
}

// ============================================================================
// Duplicate Detection and Screenshot Detection
// ============================================================================

#[derive(Serialize, Clone)]
pub struct DuplicateGroup {
    pub group_id: u32,
    pub group_type: String,        // "exact" or "similar"
    pub photos: Vec<PhotoMetadata>,
    pub similarity_score: f32,     // 0.0-1.0 (1.0 = identical)
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub total: u32,
    pub processed: u32,
    pub phase: String,
}

#[derive(Serialize)]
pub struct ArchivedPhoto {
    pub photo: PhotoMetadata,
    pub archived_at: i64,
    pub days_until_deletion: i64,
}

/// COMMAND: Scan library for duplicates and compute missing hashes
#[tauri::command]
async fn scan_for_duplicates(window: tauri::Window) -> Result<ScanProgress, String> {
    let conn = db_conn()?;

    // Get photos that need hash computation
    let photos_without_hash = db::get_photos_without_dhash(&conn)
        .map_err(|e| format!("Failed to get photos: {}", e))?;

    let total = photos_without_hash.len() as u32;
    let processed = Arc::new(AtomicU32::new(0));

    // Emit initial progress
    let _ = window.emit("scan_progress", ScanProgress {
        total,
        processed: 0,
        phase: "hashing".to_string(),
    });

    // Process photos in parallel and collect results
    let results: Vec<(String, Option<u64>)> = photos_without_hash
        .par_iter()
        .map(|(path, _name)| {
            let hash = compute_dhash(Path::new(path));

            // Update progress
            let current = processed.fetch_add(1, Ordering::SeqCst) + 1;
            if current % 10 == 0 || current == total {
                let _ = window.emit("scan_progress", ScanProgress {
                    total,
                    processed: current,
                    phase: "hashing".to_string(),
                });
            }

            (path.clone(), hash)
        })
        .collect();

    // Emit comparing phase
    let _ = window.emit("scan_progress", ScanProgress {
        total,
        processed: total,
        phase: "saving".to_string(),
    });

    // Save hashes to database (must be done sequentially, one transaction)
    if let Ok(tx) = conn.unchecked_transaction() {
        for (path, hash) in results {
            if let Some(h) = hash {
                let _ = db::update_photo_dhash(&conn, &path, h as i64);
            }
        }
        let _ = tx.commit();
    }

    // Emit completion
    let _ = window.emit("scan_progress", ScanProgress {
        total,
        processed: total,
        phase: "complete".to_string(),
    });

    Ok(ScanProgress {
        total,
        processed: total,
        phase: "complete".to_string(),
    })
}

/// COMMAND: Get duplicate groups based on hash similarity
#[tauri::command]
fn get_duplicate_groups(threshold: u32) -> Result<Vec<DuplicateGroup>, String> {
    let conn = db_conn()?;

    // Single query: metadata + dhash (avoids loading the library twice).
    let photos_with_hash = db::get_active_photos_for_duplicate_scan(&conn)
        .map_err(|e| format!("Failed to get photos: {}", e))?;

    let photo_map: HashMap<String, PhotoMetadata> = photos_with_hash
        .iter()
        .map(|(p, _)| (p.path.clone(), p.clone()))
        .collect();

    let hash_rows: Vec<(String, Option<i64>, Option<String>)> = photos_with_hash
        .iter()
        .map(|(p, dhash)| (p.path.clone(), *dhash, p.content_hash.clone()))
        .collect();

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut processed_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut group_id: u32 = 0;

    // First, find exact duplicates (same content_hash)
    let mut hash_groups: HashMap<String, Vec<String>> = HashMap::new();
    for (path, _, content_hash) in &hash_rows {
        if let Some(hash) = content_hash {
            hash_groups.entry(hash.clone()).or_default().push(path.clone());
        }
    }

    for (_, paths) in hash_groups {
        if paths.len() > 1 {
            let photos: Vec<PhotoMetadata> = paths.iter()
                .filter_map(|p| photo_map.get(p).cloned())
                .collect();

            if photos.len() > 1 {
                for path in &paths {
                    processed_paths.insert(path.clone());
                }

                groups.push(DuplicateGroup {
                    group_id,
                    group_type: "exact".to_string(),
                    photos,
                    similarity_score: 1.0,
                });
                group_id += 1;
            }
        }
    }

    // Then, find similar photos (perceptual hash within threshold)
    // Use provided threshold or fall back to configured default
    let effective_threshold = if threshold == 0 { config::DUPLICATE_HAMMING_THRESHOLD } else { threshold };

    for i in 0..hash_rows.len() {
        let (path_i, hash_i, _) = &hash_rows[i];

        if processed_paths.contains(path_i) {
            continue;
        }

        if let Some(h_i) = hash_i {
            let mut similar_paths: Vec<String> = vec![path_i.clone()];

            for j in (i + 1)..hash_rows.len() {
                let (path_j, hash_j, _) = &hash_rows[j];

                if processed_paths.contains(path_j) {
                    continue;
                }

                if let Some(h_j) = hash_j {
                    let distance = hamming_distance(*h_i as u64, *h_j as u64);
                    if distance <= effective_threshold && distance > 0 {
                        similar_paths.push(path_j.clone());
                    }
                }
            }

            if similar_paths.len() > 1 {
                let photos: Vec<PhotoMetadata> = similar_paths.iter()
                    .filter_map(|p| photo_map.get(p).cloned())
                    .collect();

                if photos.len() > 1 {
                    for path in &similar_paths {
                        processed_paths.insert(path.clone());
                    }

                    // Calculate average similarity score
                    let similarity = 1.0 - (effective_threshold as f32 / 64.0);

                    groups.push(DuplicateGroup {
                        group_id,
                        group_type: "similar".to_string(),
                        photos,
                        similarity_score: similarity,
                    });
                    group_id += 1;
                }
            }
        }
    }

    // Sort groups: exact duplicates first, then by number of photos
    groups.sort_by(|a, b| {
        if a.group_type != b.group_type {
            a.group_type.cmp(&b.group_type) // "exact" comes before "similar"
        } else {
            b.photos.len().cmp(&a.photos.len()) // More photos first
        }
    });

    Ok(groups)
}

/// COMMAND: Scan for screenshots
#[tauri::command]
async fn scan_for_screenshots(window: tauri::Window) -> Result<Vec<PhotoMetadata>, String> {
    let conn = db_conn()?;

    let total = db::count_active_photos(&conn)
        .map_err(|e| format!("Failed to count photos: {}", e))? as u32;
    let processed = Arc::new(AtomicU32::new(0));
    const BATCH: i64 = 500;

    let _ = window.emit("screenshot_scan_progress", ScanProgress {
        total,
        processed: 0,
        phase: "analyzing".to_string(),
    });

    let mut screenshots: Vec<PhotoMetadata> = Vec::new();
    let mut offset: i64 = 0;

    loop {
        let batch = db::get_active_photos_batch(&conn, offset, BATCH)
            .map_err(|e| format!("Failed to get photos: {}", e))?;
        if batch.is_empty() {
            break;
        }
        offset += batch.len() as i64;

        for photo in batch {
            let current = processed.fetch_add(1, Ordering::SeqCst) + 1;
            if current % 50 == 0 || current == total {
                let _ = window.emit("screenshot_scan_progress", ScanProgress {
                    total,
                    processed: current,
                    phase: "analyzing".to_string(),
                });
            }

            if detect_screenshot(&photo.name, photo.width, photo.height) {
                let _ = db::update_photo_screenshot_flag(&conn, &photo.path, true);
                screenshots.push(photo);
            }
        }
    }

    // Emit completion
    let _ = window.emit("screenshot_scan_progress", ScanProgress {
        total,
        processed: total,
        phase: "complete".to_string(),
    });

    Ok(screenshots)
}

/// COMMAND: Get all detected screenshots
#[tauri::command]
fn get_screenshots() -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get screenshots", |c| db::get_screenshots(c))
}

/// Move photos between the library and archive roots, mirroring the relative
/// directory structure and updating the DB path plus archived_at via `db_op`.
/// Shared body of archive_photos / restore_photos — only the direction differs.
fn move_photos_between_roots(
    paths: Vec<String>,
    from_root: &Path,
    to_root: &Path,
    db_op: impl Fn(&rusqlite::Connection, &str) -> rusqlite::Result<()>,
    action: &str,
) -> Result<(), String> {
    let conn = db_conn()?;

    for path_str in paths {
        let source = Path::new(&path_str);
        if !source.exists() {
            warn!("File not found for {}: {}", action, path_str);
            continue;
        }

        let relative_path = source.strip_prefix(from_root)
            .unwrap_or(Path::new(source.file_name().unwrap_or_default()));

        let mut dest = to_root.to_path_buf();
        if let Some(parent) = relative_path.parent() {
            dest.push(parent);
            fs::create_dir_all(&dest).ok();
        }
        dest.push(relative_path.file_name().unwrap_or_default());

        match fs::rename(source, &dest) {
            Ok(_) => {
                let canonical_dest = dest.canonicalize()
                    .unwrap_or(dest.clone())
                    .to_string_lossy()
                    .to_string();

                // Update the path first, then flip archived_at via db_op.
                let _ = conn.execute(
                    "UPDATE photos SET path = ?1 WHERE path = ?2",
                    rusqlite::params![canonical_dest, path_str],
                );
                db_op(&conn, &canonical_dest)
                    .map_err(|e| format!("Failed to {} in DB: {}", action, e))?;

                debug!("{}: {} -> {}", action, path_str, canonical_dest);
            }
            Err(e) => {
                error!("Failed to move file during {}: {}", action, e);
            }
        }
    }

    Ok(())
}

/// COMMAND: Archive photos (move to archive folder, set archived_at)
#[tauri::command]
fn archive_photos(paths: Vec<String>) -> Result<(), String> {
    move_photos_between_roots(
        paths,
        &db::get_library_path(),
        &db::get_archive_path(),
        db::archive_photo,
        "archive",
    )
}

/// COMMAND: Restore photos from archive
#[tauri::command]
fn restore_photos(paths: Vec<String>) -> Result<(), String> {
    move_photos_between_roots(
        paths,
        &db::get_archive_path(),
        &db::get_library_path(),
        db::restore_photo,
        "restore",
    )
}

/// COMMAND: Get archived photos with days until deletion
#[tauri::command]
fn get_archived_photos() -> Result<Vec<ArchivedPhoto>, String> {
    let conn = db_conn()?;
    let archived = db::get_archived_photos(&conn)
        .map_err(|e| format!("Failed to get archived photos: {}", e))?;

    let now = chrono::Utc::now().timestamp();

    let result: Vec<ArchivedPhoto> = archived
        .into_iter()
        .map(|(photo, archived_at)| {
            let days_passed = (now - archived_at) / (24 * 60 * 60);
            let days_until_deletion = (config::ARCHIVE_DELETION_DAYS - days_passed).max(0);

            ArchivedPhoto {
                photo,
                archived_at,
                days_until_deletion,
            }
        })
        .collect();

    Ok(result)
}

/// COMMAND: Clean up old archived photos (older than configured days)
#[tauri::command]
fn cleanup_old_archives() -> Result<u32, String> {
    let conn = db_conn()?;

    let old_paths = db::get_old_archived_photos(&conn, config::ARCHIVE_DELETION_DAYS)
        .map_err(|e| format!("Failed to get old archives: {}", e))?;

    let mut deleted_count: u32 = 0;

    for path_str in old_paths {
        let path = Path::new(&path_str);

        // Delete file from filesystem
        if path.exists() {
            if let Err(e) = fs::remove_file(path) {
                error!("Failed to delete file {}: {}", path_str, e);
                continue;
            }
        }

        // Delete from database
        if let Err(e) = db::permanently_delete_photo(&conn, &path_str) {
            error!("Failed to delete from DB {}: {}", path_str, e);
            continue;
        }

        debug!("Permanently deleted: {}", path_str);
        deleted_count += 1;
    }

    Ok(deleted_count)
}

// ============================================================================
// TerraForm (Review Mode) Commands
// ============================================================================

/// COMMAND: Get all unreviewed photos for TerraForm
#[tauri::command]
fn get_unreviewed_photos() -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get unreviewed photos", |c| db::get_unreviewed_photos(c))
}

/// COMMAND: Mark a photo as reviewed
#[tauri::command]
fn mark_photo_reviewed(path: String) -> Result<(), String> {
    with_db("Failed to mark photo reviewed", |c| db::mark_photo_reviewed(c, &path))
}

/// COMMAND: Get count of unreviewed photos
#[tauri::command]
fn get_unreviewed_count() -> Result<i64, String> {
    with_db("Failed to get unreviewed count", |c| db::get_unreviewed_count(c))
}

/// COMMAND: Unmark a photo as reviewed (for undo)
#[tauri::command]
fn unmark_photo_reviewed(path: String) -> Result<(), String> {
    with_db("Failed to unmark photo reviewed", |c| db::unmark_photo_reviewed(c, &path))
}

// ============================================================================
// Tag Commands
// ============================================================================

/// COMMAND: Create a new tag
#[tauri::command]
fn create_tag(name: String, color: String) -> Result<i64, String> {
    with_db("Failed to create tag", |c| db::create_tag(c, &name, &color))
}

/// COMMAND: Update a tag
#[tauri::command]
fn update_tag(id: i64, name: String, color: String) -> Result<(), String> {
    with_db("Failed to update tag", |c| db::update_tag(c, id, &name, &color))
}

/// COMMAND: Get all tags
#[tauri::command]
fn get_all_tags() -> Result<Vec<db::Tag>, String> {
    with_db("Failed to get tags", |c| db::get_all_tags(c))
}

/// COMMAND: Get tags for a specific photo
#[tauri::command]
fn get_tags_for_photo(path: String) -> Result<Vec<db::Tag>, String> {
    with_db("Failed to get tags for photo", |c| db::get_tags_for_photo(c, &path))
}

/// COMMAND: Add tags to photos
#[tauri::command]
fn add_tags_to_photos(tag_ids: Vec<i64>, photo_paths: Vec<String>) -> Result<(), String> {
    with_db("Failed to add tags", |c| db::add_tags_to_photos(c, &tag_ids, &photo_paths))
}

/// COMMAND: Remove a tag from a photo
#[tauri::command]
fn remove_tag_from_photo(tag_id: i64, photo_path: String) -> Result<(), String> {
    with_db("Failed to remove tag", |c| db::remove_tag_from_photo(c, tag_id, &photo_path))
}

/// COMMAND: Search tags for autocomplete
#[tauri::command]
fn search_tags(query: String) -> Result<Vec<db::Tag>, String> {
    with_db("Failed to search tags", |c| db::search_tags(c, &query))
}

// ============================================================================
// Settings Commands
// ============================================================================

/// COMMAND: Get the current library path
#[tauri::command]
fn get_library_path_command() -> Result<String, String> {
    Ok(db::get_library_path().to_string_lossy().to_string())
}

/// COMMAND: Set the library path
#[tauri::command]
fn set_library_path(path: String) -> Result<(), String> {
    with_db("Failed to set library path", |c| db::set_setting(c, "library_path", &path))
}

// ============================================================================
// Smart Collections Commands
// ============================================================================

/// COMMAND: Get smart collection metadata. Counts come from get_view_counts.
#[tauri::command]
fn get_smart_collections() -> &'static [db::SmartCollection] {
    db::SMART_COLLECTIONS
}

// ============================================================================
// Storage Analytics Commands
// ============================================================================

/// COMMAND: Get storage analytics
#[tauri::command]
fn get_storage_analytics() -> Result<db::StorageAnalytics, String> {
    with_db("Failed to get storage analytics", |c| db::get_storage_analytics(c))
}

/// COMMAND: Populate file sizes for all photos (one-time migration)
#[tauri::command]
async fn populate_file_sizes(window: tauri::Window) -> Result<ScanProgress, String> {
    let conn = db_conn()?;

    let paths = db::get_photos_without_file_size(&conn)
        .map_err(|e| format!("Failed to get photos: {}", e))?;

    let total = paths.len() as u32;
    let processed = Arc::new(AtomicU32::new(0));

    // Emit initial progress
    let _ = window.emit("file_size_progress", ScanProgress {
        total,
        processed: 0,
        phase: "calculating".to_string(),
    });

    // Process in parallel
    let results: Vec<(String, Option<u64>)> = paths
        .par_iter()
        .map(|path| {
            let size = fs::metadata(path).ok().map(|m| m.len());

            let current = processed.fetch_add(1, Ordering::SeqCst) + 1;
            if current % 50 == 0 || current == total {
                let _ = window.emit("file_size_progress", ScanProgress {
                    total,
                    processed: current,
                    phase: "calculating".to_string(),
                });
            }

            (path.clone(), size)
        })
        .collect();

    // Save to database
    let _ = window.emit("file_size_progress", ScanProgress {
        total,
        processed: total,
        phase: "saving".to_string(),
    });

    if let Ok(tx) = conn.unchecked_transaction() {
        for (path, size) in results {
            if let Some(s) = size {
                let _ = db::update_photo_file_size(&conn, &path, s as i64);
            }
        }
        let _ = tx.commit();
    }

    let _ = window.emit("file_size_progress", ScanProgress {
        total,
        processed: total,
        phase: "complete".to_string(),
    });

    Ok(ScanProgress {
        total,
        processed: total,
        phase: "complete".to_string(),
    })
}

// ============================================================================
// Metadata Enrichment Commands
// ============================================================================

/// COMMAND: Backfill enriched metadata for all photos lacking camera_make.
/// Emits `metadata_enrich_progress` events every 10 photos.
/// Returns the count of photos successfully enriched.
#[tauri::command]
async fn enrich_all_metadata(app: tauri::AppHandle) -> Result<usize, String> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Emitter;

    let conn = db_conn()?;
    let paths = db::get_photos_without_enrichment(&conn)
        .map_err(|e| format!("Failed to get unenriched photos: {}", e))?;

    let total = paths.len();
    let enriched_count = Arc::new(AtomicUsize::new(0));

    // Collect (path, result) pairs in parallel; each thread spawns its own python3.
    let results: Vec<(String, Result<metadata_enrich::EnrichedMetadata, String>)> = paths
        .par_iter()
        .map(|path| {
            let result = enrich_path(&app, path);
            (path.clone(), result)
        })
        .collect();

    // Write results sequentially and emit progress events.
    let write_conn = db_conn()?;
    for (i, (path, result)) in results.into_iter().enumerate() {
        if let Ok(meta) = result {
            if db::update_enriched_metadata(&write_conn, &path, &meta).is_ok() {
                enriched_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        if (i + 1) % 10 == 0 || i + 1 == total {
            let _ = app.emit("metadata_enrich_progress", serde_json::json!({
                "processed": i + 1,
                "total": total,
            }));
        }
    }

    Ok(enriched_count.load(Ordering::Relaxed))
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    Ok(())
}

/// COMMAND: Return the canonical thumbnail cache root as an absolute path.
/// The frontend uses this to derive content-addressed thumb URLs without
/// a per-photo IPC round trip.
#[tauri::command]
fn get_thumb_cache_root() -> Result<String, String> {
    Ok(thumbnails::thumb_cache_root().to_string_lossy().into_owned())
}

/// COMMAND: Backfill thumbnails for every photo lacking one.
/// Emits `thumbnail_progress` events every 20 items.
/// Returns the count of thumbnails successfully generated.
#[tauri::command]
async fn generate_missing_thumbnails(app: tauri::AppHandle) -> Result<usize, String> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Emitter;

    let conn = db_conn()?;
    let photos = db::get_photos_without_thumbnails(&conn)
        .map_err(|e| format!("Failed to query photos: {}", e))?;
    drop(conn);

    let total = photos.len();
    if total == 0 {
        return Ok(0);
    }

    let count = Arc::new(AtomicUsize::new(0));

    // Decode + resize in parallel; each thread is CPU-bound on JPEG.
    let results: Vec<(String, &'static str)> = photos
        .par_iter()
        .map(|(path, hash)| {
            let src = Path::new(path);
            if media::is_video(src) {
                return (path.clone(), "unsupported");
            }
            match thumbnails::generate_thumbnail(src, hash, thumbnails::THUMB_SIZE) {
                Ok(_) => (path.clone(), "ready"),
                Err(_) => (path.clone(), "failed"),
            }
        })
        .collect();

    // Persist results sequentially; SQLite handles serialized writes best.
    let write_conn = db_conn()?;
    for (i, (path, status)) in results.into_iter().enumerate() {
        let _ = db::set_thumb_status(&write_conn, &path, status);
        if status == "ready" {
            count.fetch_add(1, Ordering::Relaxed);
        }
        if (i + 1) % 20 == 0 || i + 1 == total {
            let _ = app.emit(
                "thumbnail_progress",
                serde_json::json!({ "processed": i + 1, "total": total }),
            );
        }
    }

    Ok(count.load(Ordering::Relaxed))
}

// ============================================================================
// Pagination commands (PAGINATION_PLAN.md, P.1)
// ============================================================================

/// COMMAND: Fetch a single page of photos for the given filter.
/// `cursor=None` returns the first page. `next_cursor` in the result is
/// `None` when no further rows exist.
#[tauri::command]
fn get_photos_page(
    filter: ViewFilter,
    cursor: Option<Cursor>,
    limit: i64,
) -> Result<PageResult, String> {
    with_db("get_photos_page", |conn| {
        db::get_photos_page(conn, &filter, cursor.as_ref(), limit)
    })
}

/// COMMAND: Top-level counts for sidebar badges plus per-album / per-tag /
/// per-smart-collection maps. Each value is one indexed COUNT(*); frontend
/// caches the result and refreshes after mutations.
#[tauri::command]
fn get_view_counts() -> Result<ViewCounts, String> {
    with_db("get_view_counts", |conn| db::get_view_counts(conn))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging. Set RUST_LOG=debug for verbose output.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Terra starting up...");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            upload_photos,
            import_provider_export,
            toggle_favorite,
            create_album,
            get_albums,
            add_to_album,
            delete_photos,
            get_locations,
            // Duplicate and screenshot detection
            scan_for_duplicates,
            get_duplicate_groups,
            scan_for_screenshots,
            get_screenshots,
            // Archive management
            archive_photos,
            restore_photos,
            get_archived_photos,
            cleanup_old_archives,
            // TerraForm (Review Mode)
            get_unreviewed_photos,
            mark_photo_reviewed,
            get_unreviewed_count,
            unmark_photo_reviewed,
            // Tags
            create_tag,
            update_tag,
            get_all_tags,
            get_tags_for_photo,
            add_tags_to_photos,
            remove_tag_from_photo,
            search_tags,
            // Settings
            get_library_path_command,
            set_library_path,
            // Smart Collections
            get_smart_collections,
            // Storage Analytics
            get_storage_analytics,
            populate_file_sizes,
            // Metadata Enrichment
            enrich_all_metadata,
            // Thumbnails
            get_thumb_cache_root,
            generate_missing_thumbnails,
            // Pagination (PAGINATION_PLAN.md)
            get_photos_page,
            get_view_counts,
            // Finder integration
            reveal_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
