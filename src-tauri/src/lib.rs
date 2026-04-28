use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use rayon::prelude::*;
use reverse_geocoder::ReverseGeocoder;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use walkdir::WalkDir;
use log::{debug, error, info, warn};

mod db;
mod media;
mod metadata_enrich;
mod thumbnails;

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

/// COMMAND: Get all photos from the database
#[tauri::command]
fn get_all_photos() -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get photos", |c| db::get_all_photos(c))
}

#[tauri::command]
fn scan_directory(dir_path: String, save_to_db: bool) -> Result<Vec<PhotoMetadata>, String> {
    info!("Scanning directory: {}", dir_path);

    // Use cached geocoder locations for better performance
    let geocoder = ReverseGeocoder::new(&GEOCODER_LOCATIONS);

    // 1. Collect all image paths efficiently
    let entries: Vec<_> = WalkDir::new(&dir_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let path = e.path();
            if !path.is_file() {
                return false;
            }
            let ext = path.extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "heic" | "webp" | "gif" | "bmp" | "mp4" | "mov" | "avi" | "webm" | "mkv")
        })
        .collect();

    info!("Found {} image files", entries.len());

    // 2. Process metadata in parallel using Rayon
    let photos: Vec<PhotoMetadata> = entries
        .par_iter()
        .filter_map(|entry| process_image(entry.path(), Some(&geocoder)))
        .collect();

    info!("Successfully processed {} photos", photos.len());

    // 3. Optionally save to database
    if save_to_db {
        let conn = db_conn()?;
        for photo in &photos {
            db::insert_photo(&conn, photo, "scan")
                .map_err(|e| format!("Failed to insert photo: {}", e))?;
        }
        info!("Saved {} photos to database", photos.len());
    }

    Ok(photos)
}

/// COMMAND: Upload Photos
/// Copies photos to the Terra managed library and saves metadata to database
#[tauri::command]
fn upload_photos(file_paths: Vec<String>) -> Result<Vec<PhotoMetadata>, String> {
    info!("Uploading {} photos", file_paths.len());

    let library_path = db::get_library_path();
    let conn = db_conn()?;

    // Use cached geocoder locations for better performance
    let geocoder = ReverseGeocoder::new(&GEOCODER_LOCATIONS);

    let uploaded_photos: Vec<PhotoMetadata> = file_paths
        .iter()
        .filter_map(|file_path| {
            let source_path = Path::new(file_path);
            if !source_path.exists() {
                warn!("File not found: {}", file_path);
                return None;
            }

            // Process the image to get metadata (especially date_taken)
            let mut photo = process_image(source_path, Some(&geocoder))?;

            // Check for duplicates
            if let Some(hash) = &photo.content_hash {
                match db::hash_exists(&conn, hash) {
                    Ok(exists) => {
                        if exists {
                            debug!("Skipping duplicate photo: {} (hash: {})", photo.name, hash);
                            return None;
                        }
                    },
                    Err(e) => warn!("Failed to check hash existence: {}", e),
                }
            }

            // Create year/month subdirectories based on date_taken
            let date = chrono::DateTime::from_timestamp(photo.date_taken, 0)?;
            let year = date.format("%Y").to_string();
            let month = date.format("%m").to_string();

            let mut dest_dir = library_path.clone();
            dest_dir.push(&year);
            dest_dir.push(&month);

            // Create directories if they don't exist
            fs::create_dir_all(&dest_dir).ok()?;

            // Copy file to managed location
            let file_name = source_path.file_name()?.to_string_lossy().to_string();
            let mut dest_path = dest_dir;
            dest_path.push(&file_name);

            // Handle duplicate filenames by appending a number
            let mut final_dest_path = dest_path.clone();
            let mut counter = 1;
            while final_dest_path.exists() {
                let stem = source_path.file_stem()?.to_string_lossy();
                let ext = source_path.extension()?.to_string_lossy();
                final_dest_path = dest_path.with_file_name(format!("{}_{}.{}", stem, counter, ext));
                counter += 1;
            }

            // Copy the file
            match fs::copy(source_path, &final_dest_path) {
                Ok(_) => debug!("Copied {} to {}", file_path, final_dest_path.display()),
                Err(e) => {
                    error!("Failed to copy {}: {}", file_path, e);
                    return None;
                }
            }

            // Canonicalize the destination path for Tauri file access
            let canonical_dest = match final_dest_path.canonicalize() {
                Ok(p) => {
                    debug!("Canonicalized destination: {}", p.display());
                    p.to_string_lossy().to_string()
                },
                Err(e) => {
                    warn!("Could not canonicalize destination {:?}: {}", final_dest_path, e);
                    final_dest_path.to_string_lossy().to_string()
                }
            };

            // Update photo path to the new canonicalized location
            photo.path = canonical_dest.clone();
            photo.name = final_dest_path.file_name()?.to_string_lossy().to_string();

            // Save to database
            match db::insert_photo(&conn, &photo, "upload") {
                Ok(_) => debug!("Saved to database: {}", photo.name),
                Err(e) => {
                    error!("Failed to save {} to database: {}", photo.name, e);
                    return None;
                }
            }

            // Compute perceptual hash for duplicate detection
            if let Some(dhash) = compute_dhash(&final_dest_path) {
                let _ = db::update_photo_dhash(&conn, &photo.path, dhash as i64);
                debug!("Computed dhash for {}: {}", photo.name, dhash);
            }

            // Detect if this is a screenshot
            let is_screenshot = detect_screenshot(&photo.name, photo.width, photo.height);
            if is_screenshot {
                let _ = db::update_photo_screenshot_flag(&conn, &photo.path, true);
                debug!("Detected screenshot: {}", photo.name);
            }

            debug!("Successfully uploaded: {} -> {}", file_path, photo.path);
            Some(photo)
        })
        .collect();

    info!("Successfully uploaded {} photos", uploaded_photos.len());
    Ok(uploaded_photos)
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
fn delete_album(id: i64) -> Result<(), String> {
    with_db("Failed to delete album", |c| db::delete_album(c, id))
}

#[tauri::command]
fn get_albums() -> Result<Vec<db::Album>, String> {
    with_db("Failed to get albums", |c| db::get_albums(c))
}

#[tauri::command]
fn add_to_album(album_id: i64, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    for path in photo_paths {
        db::add_photo_to_album(&conn, album_id, &path).map_err(|e| format!("Failed to add to album: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn remove_from_album(album_id: i64, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    for path in photo_paths {
        db::remove_photo_from_album(&conn, album_id, &path).map_err(|e| format!("Failed to remove from album: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn get_album_photos(album_id: i64) -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get album photos", |c| db::get_album_photos(c, album_id))
}

#[tauri::command]
fn set_album_cover(album_id: i64, photo_path: String) -> Result<(), String> {
    with_db("Failed to set album cover", |c| db::set_album_cover(c, album_id, &photo_path))
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
fn get_duplicates() -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get duplicates", |c| db::get_duplicates(c))
}

#[tauri::command]
fn search_photos(query: String) -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to search photos", |c| db::search_photos(c, &query))
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

    // Save hashes to database (must be done sequentially)
    for (path, hash) in results {
        if let Some(h) = hash {
            let _ = db::update_photo_dhash(&conn, &path, h as i64);
        }
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

    // Get all photos with their hashes
    let photos_with_hash = db::get_all_photos_with_dhash(&conn)
        .map_err(|e| format!("Failed to get photos: {}", e))?;

    // Also get full photo metadata for later
    let all_photos = db::get_all_photos(&conn)
        .map_err(|e| format!("Failed to get photo metadata: {}", e))?;

    // Create a map for quick lookup
    let photo_map: HashMap<String, PhotoMetadata> = all_photos
        .into_iter()
        .map(|p| (p.path.clone(), p))
        .collect();

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut processed_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut group_id: u32 = 0;

    // First, find exact duplicates (same content_hash)
    let mut hash_groups: HashMap<String, Vec<String>> = HashMap::new();
    for (path, _, content_hash) in &photos_with_hash {
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

    for i in 0..photos_with_hash.len() {
        let (path_i, hash_i, _) = &photos_with_hash[i];

        if processed_paths.contains(path_i) {
            continue;
        }

        if let Some(h_i) = hash_i {
            let mut similar_paths: Vec<String> = vec![path_i.clone()];

            for j in (i + 1)..photos_with_hash.len() {
                let (path_j, hash_j, _) = &photos_with_hash[j];

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

    // Get all non-archived photos
    let all_photos = db::get_all_photos(&conn)
        .map_err(|e| format!("Failed to get photos: {}", e))?;

    let total = all_photos.len() as u32;
    let processed = Arc::new(AtomicU32::new(0));

    // Emit initial progress
    let _ = window.emit("screenshot_scan_progress", ScanProgress {
        total,
        processed: 0,
        phase: "analyzing".to_string(),
    });

    // Check each photo for screenshot characteristics
    let screenshots: Vec<PhotoMetadata> = all_photos
        .into_iter()
        .filter(|photo| {
            let current = processed.fetch_add(1, Ordering::SeqCst) + 1;
            if current % 50 == 0 || current == total {
                let _ = window.emit("screenshot_scan_progress", ScanProgress {
                    total,
                    processed: current,
                    phase: "analyzing".to_string(),
                });
            }

            let is_screenshot = detect_screenshot(&photo.name, photo.width, photo.height);

            // Update database
            if is_screenshot {
                let _ = db::update_photo_screenshot_flag(&conn, &photo.path, true);
            }

            is_screenshot
        })
        .collect();

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

/// COMMAND: Archive photos (move to archive folder, set archived_at)
#[tauri::command]
fn archive_photos(paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    let archive_path = db::get_archive_path();

    for path_str in paths {
        let source = Path::new(&path_str);
        if !source.exists() {
            warn!("File not found for archiving: {}", path_str);
            continue;
        }

        // Create relative path structure in archive
        let library_path = db::get_library_path();
        let relative_path = source.strip_prefix(&library_path)
            .unwrap_or(Path::new(source.file_name().unwrap_or_default()));

        let mut dest = archive_path.clone();
        if let Some(parent) = relative_path.parent() {
            dest.push(parent);
            fs::create_dir_all(&dest).ok();
        }
        dest.push(relative_path.file_name().unwrap_or_default());

        // Move file to archive
        match fs::rename(&source, &dest) {
            Ok(_) => {
                // Update database with new path and archived_at timestamp
                let canonical_dest = dest.canonicalize()
                    .unwrap_or(dest.clone())
                    .to_string_lossy()
                    .to_string();

                // First update the path in the database
                let _ = conn.execute(
                    "UPDATE photos SET path = ?1 WHERE path = ?2",
                    rusqlite::params![canonical_dest, path_str],
                );

                // Then set archived_at
                db::archive_photo(&conn, &canonical_dest)
                    .map_err(|e| format!("Failed to archive in DB: {}", e))?;

                debug!("Archived: {} -> {}", path_str, canonical_dest);
            }
            Err(e) => {
                error!("Failed to move file to archive: {}", e);
            }
        }
    }

    Ok(())
}

/// COMMAND: Restore photos from archive
#[tauri::command]
fn restore_photos(paths: Vec<String>) -> Result<(), String> {
    let conn = db_conn()?;
    let library_path = db::get_library_path();
    let archive_path = db::get_archive_path();

    for path_str in paths {
        let source = Path::new(&path_str);
        if !source.exists() {
            warn!("File not found for restoration: {}", path_str);
            continue;
        }

        // Restore to original location in library
        let relative_path = source.strip_prefix(&archive_path)
            .unwrap_or(Path::new(source.file_name().unwrap_or_default()));

        let mut dest = library_path.clone();
        if let Some(parent) = relative_path.parent() {
            dest.push(parent);
            fs::create_dir_all(&dest).ok();
        }
        dest.push(relative_path.file_name().unwrap_or_default());

        // Move file back to library
        match fs::rename(&source, &dest) {
            Ok(_) => {
                let canonical_dest = dest.canonicalize()
                    .unwrap_or(dest.clone())
                    .to_string_lossy()
                    .to_string();

                // Update path in database
                let _ = conn.execute(
                    "UPDATE photos SET path = ?1 WHERE path = ?2",
                    rusqlite::params![canonical_dest, path_str],
                );

                // Clear archived_at
                db::restore_photo(&conn, &canonical_dest)
                    .map_err(|e| format!("Failed to restore in DB: {}", e))?;

                debug!("Restored: {} -> {}", path_str, canonical_dest);
            }
            Err(e) => {
                error!("Failed to restore file: {}", e);
            }
        }
    }

    Ok(())
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

/// COMMAND: Delete a tag
#[tauri::command]
fn delete_tag(id: i64) -> Result<(), String> {
    with_db("Failed to delete tag", |c| db::delete_tag(c, id))
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

/// COMMAND: Get photos by tags
#[tauri::command]
fn get_photos_by_tags(tag_ids: Vec<i64>, match_all: bool) -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get photos by tags", |c| db::get_photos_by_tags(c, &tag_ids, match_all))
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

/// COMMAND: Get a setting value
#[tauri::command]
fn get_setting_command(key: String) -> Result<Option<String>, String> {
    let conn = db_conn()?;
    Ok(db::get_setting(&conn, &key))
}

// ============================================================================
// Smart Collections Commands
// ============================================================================

/// COMMAND: Get all smart collections with counts
#[tauri::command]
fn get_smart_collections() -> Result<Vec<db::SmartCollection>, String> {
    with_db("Failed to get smart collections", |c| db::get_smart_collections(c))
}

/// COMMAND: Get photos for a smart collection
#[tauri::command]
fn get_smart_collection_photos(collection_id: String) -> Result<Vec<PhotoMetadata>, String> {
    with_db("Failed to get collection photos", |c| db::get_smart_collection_photos(c, &collection_id))
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

    for (path, size) in results {
        if let Some(s) = size {
            let _ = db::update_photo_file_size(&conn, &path, s as i64);
        }
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

/// COMMAND: Enrich a single photo's metadata via the Python exiftool wrapper.
#[tauri::command]
fn enrich_photo_metadata(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let meta = enrich_path(&app, &path)?;
    let conn = db_conn()?;
    db::update_enriched_metadata(&conn, &path, &meta)
        .map_err(|e| format!("Failed to save enriched metadata: {}", e))
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging. Set RUST_LOG=debug for verbose output.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Terra starting up...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            get_all_photos,
            upload_photos,
            toggle_favorite,
            create_album,
            delete_album,
            get_albums,
            add_to_album,
            remove_from_album,
            get_album_photos,
            set_album_cover,
            delete_photos,
            get_duplicates,
            search_photos,
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
            delete_tag,
            get_all_tags,
            get_tags_for_photo,
            add_tags_to_photos,
            remove_tag_from_photo,
            get_photos_by_tags,
            search_tags,
            // Settings
            get_library_path_command,
            set_library_path,
            get_setting_command,
            // Smart Collections
            get_smart_collections,
            get_smart_collection_photos,
            // Storage Analytics
            get_storage_analytics,
            populate_file_sizes,
            // Metadata Enrichment
            enrich_photo_metadata,
            enrich_all_metadata,
            // Thumbnails
            get_thumb_cache_root,
            generate_missing_thumbnails,
            // Finder integration
            reveal_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

