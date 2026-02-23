use std::fs;
use std::path::Path;
use std::time::{UNIX_EPOCH, SystemTime};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use walkdir::WalkDir;
use rayon::prelude::*;
use serde::{Serialize, Deserialize};
use chrono::NaiveDateTime;
use std::io::Read;
use sha2::{Sha256, Digest};
use regex::Regex;
use reverse_geocoder::{ReverseGeocoder, Locations};
use lazy_static::lazy_static;
use image_hasher::{HasherConfig, HashAlg};
use tauri::Emitter;
use log::{debug, info, warn, error};

mod db;

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

// Cache compiled regex patterns and geocoder data for performance
lazy_static! {
    static ref DATE_REGEX: Regex = Regex::new(r"(\d{4})[_-](\d{2})[_-](\d{2})").unwrap();
    static ref TIME_REGEX: Regex = Regex::new(r"_(\d{2})(\d{2})(\d{2})").unwrap();
    static ref GEOCODER_LOCATIONS: Locations = Locations::from_memory();
    // Screenshot filename patterns
    static ref SCREENSHOT_REGEX: Regex = Regex::new(r"(?i)(screenshot|screen[\s_-]?shot|capture|snip|grab)").unwrap();
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
}

/// Parse EXIF DateTimeOriginal field (format: "2023:01:15 14:30:45")
pub(crate) fn parse_exif_datetime(datetime_str: &str) -> Option<i64> {
    // Trim null terminators and whitespace that can appear in EXIF strings
    let datetime_str = datetime_str.trim_end_matches('\0').trim();

    let cleaned = datetime_str.replace(':', "-");
    let parts: Vec<&str> = cleaned.split(' ').collect();

    if parts.len() != 2 {
        debug!("Invalid EXIF datetime format: {}", datetime_str);
        return None;
    }

    let date_part = parts[0];
    let time_part = parts[1].replace('-', ":");
    let combined = format!("{} {}", date_part, time_part);

    match NaiveDateTime::parse_from_str(&combined, "%Y-%m-%d %H:%M:%S") {
        Ok(dt) => Some(dt.and_utc().timestamp()),
        Err(e) => {
            debug!("Failed to parse EXIF datetime '{}': {}", combined, e);
            None
        }
    }
}

/// Try to extract date from filename (e.g., "2017-11-26_030858.jpeg")
pub(crate) fn parse_filename_date(filename: &str) -> Option<i64> {
    // Use cached regex patterns for better performance
    if let Some(caps) = DATE_REGEX.captures(filename) {
        let year: i32 = caps.get(1)?.as_str().parse().ok()?;
        let month: u32 = caps.get(2)?.as_str().parse().ok()?;
        let day: u32 = caps.get(3)?.as_str().parse().ok()?;

        // Validate date ranges
        if year < config::MIN_VALID_YEAR || year > config::MAX_VALID_YEAR || month < 1 || month > 12 || day < 1 || day > 31 {
            return None;
        }

        // Try to parse time too if available (HHMMSS format)
        let (hour, min, sec) = if let Some(time_caps) = TIME_REGEX.captures(filename) {
            (
                time_caps.get(1)?.as_str().parse().ok()?,
                time_caps.get(2)?.as_str().parse().ok()?,
                time_caps.get(3)?.as_str().parse().ok()?
            )
        } else {
            (0, 0, 0)
        };

        let date_str = format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, day, hour, min, sec);
        match NaiveDateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S") {
            Ok(dt) => {
                debug!("Extracted date from filename '{}': {}", filename, date_str);
                Some(dt.and_utc().timestamp())
            },
            Err(_) => None
        }
    } else {
        None
    }
}

/// Extract EXIF metadata from an image file
fn extract_exif_date(path: &Path) -> Option<i64> {
    let exif_data = match rexif::parse_file(path) {
        Ok(data) => data,
        Err(e) => {
            debug!("Failed to parse EXIF for {:?}: {}", path.file_name(), e);
            return None;
        }
    };

    // Try DateTimeOriginal first (most accurate for photos)
    for entry in &exif_data.entries {
        if entry.tag == rexif::ExifTag::DateTimeOriginal || entry.tag == rexif::ExifTag::DateTime {
            if let rexif::TagValue::Ascii(ref s) = entry.value {
                // Trim null terminators that can appear in EXIF strings
                let trimmed = s.trim_end_matches('\0').trim();
                if let Some(timestamp) = parse_exif_datetime(trimmed) {
                    debug!("Found EXIF date for {:?}: {}", path.file_name(), trimmed);
                    return Some(timestamp);
                }
            }
        }
    }

    debug!("No EXIF date found for {:?}", path.file_name());
    None
}

/// Get file modified time as Unix timestamp
fn get_file_modified_time(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Calculate SHA-256 hash of a file
fn calculate_hash(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 1024 * 1024]; // 1MB buffer

    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Some(hex::encode(hasher.finalize()))
}

/// Extract GPS coordinates from EXIF
fn extract_gps(path: &Path) -> Option<(f64, f64)> {
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown");

    let exif_data = match rexif::parse_file(path) {
        Ok(data) => data,
        Err(_) => {
            // Don't log here - already logged in extract_exif_date
            return None;
        }
    };

    let mut lat: Option<f64> = None;
    let mut lon: Option<f64> = None;
    let mut lat_ref = 1.0;
    let mut lon_ref = 1.0;

    for entry in &exif_data.entries {
        match entry.tag {
            rexif::ExifTag::GPSLatitude => {
                if let rexif::TagValue::URational(ref values) = entry.value {
                    if values.len() == 3 {
                        lat = Some(values[0].value() + values[1].value() / 60.0 + values[2].value() / 3600.0);
                    }
                }
            },
            rexif::ExifTag::GPSLongitude => {
                if let rexif::TagValue::URational(ref values) = entry.value {
                    if values.len() == 3 {
                        lon = Some(values[0].value() + values[1].value() / 60.0 + values[2].value() / 3600.0);
                    }
                }
            },
            rexif::ExifTag::GPSLatitudeRef => {
                if let rexif::TagValue::Ascii(ref s) = entry.value {
                    if s.starts_with("S") {
                        lat_ref = -1.0;
                    }
                }
            },
            rexif::ExifTag::GPSLongitudeRef => {
                if let rexif::TagValue::Ascii(ref s) = entry.value {
                    if s.starts_with("W") {
                        lon_ref = -1.0;
                    }
                }
            },
            _ => {}
        }
    }

    if let (Some(l), Some(ln)) = (lat, lon) {
        let final_lat = l * lat_ref;
        let final_lon = ln * lon_ref;
        debug!("Found GPS coordinates for {}: ({}, {})", filename, final_lat, final_lon);
        Some((final_lat, final_lon))
    } else {
        debug!("No GPS data in EXIF for {}", filename);
        None
    }
}

/// Get location name from coordinates
fn get_location_name(lat: f64, lon: f64, geocoder: &ReverseGeocoder) -> Option<String> {
    let search_result = geocoder.search((lat, lon))?;
    let location = format!("{}, {}", search_result.record.name, search_result.record.admin1);
    debug!("Reverse geocoded ({}, {}) -> {}", lat, lon, location);
    Some(location)
}

/// Process a single image file and extract metadata
fn process_image(path: &Path, geocoder: Option<&ReverseGeocoder>) -> Option<PhotoMetadata> {
    let name = path.file_name()?.to_string_lossy().to_string();

    // Canonicalize path for reliable Tauri file access with convertFileSrc
    let canonical_path = match path.canonicalize() {
        Ok(p) => {
            debug!("Canonicalized path for {}: {}", name, p.display());
            p.to_string_lossy().to_string()
        },
        Err(e) => {
            warn!("Could not canonicalize path {:?}: {}", path, e);
            path.to_string_lossy().to_string()
        }
    };

    // Try EXIF first, then filename parsing, then file modified time, then current time
    let date_taken = extract_exif_date(path)
        .or_else(|| {
            let filename_date = parse_filename_date(&name);
            if filename_date.is_some() {
                debug!("Extracted date from filename for {}", name);
            }
            filename_date
        })
        .or_else(|| {
            let mtime = get_file_modified_time(path);
            if mtime.is_some() {
                debug!("Using file modified time for {}", name);
            }
            mtime
        })
        .unwrap_or_else(|| {
            // Use current time as last resort instead of epoch
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            warn!("No date found for {}, using current time: {}", name, now);
            now
        });

    // Get image dimensions
    let (width, height) = if is_video(path) {
        (0, 0) // Skip dimension extraction for videos for now
    } else {
        match image::open(path) {
            Ok(img) => (img.width(), img.height()),
            Err(e) => {
                warn!("Failed to read image dimensions for {}: {}", name, e);
                (0, 0)
            }
        }
    };

    // Calculate hash
    let content_hash = calculate_hash(path);

    // Extract location
    let mut latitude = None;
    let mut longitude = None;
    let mut location_name = None;

    if let Some((lat, lon)) = extract_gps(path) {
        latitude = Some(lat);
        longitude = Some(lon);
        if let Some(geo) = geocoder {
            location_name = get_location_name(lat, lon, geo);
        }
    }

    Some(PhotoMetadata {
        path: canonical_path,
        name,
        date_taken,
        width,
        height,
        is_favorite: false, // Default to false for new/scanned photos
        content_hash,
        latitude,
        longitude,
        location_name,
    })
}

pub(crate) fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "mp4" | "mov" | "avi" | "webm" | "mkv"))
        .unwrap_or(false)
}

/// COMMAND: Get all photos from the database
#[tauri::command]
fn get_all_photos() -> Result<Vec<PhotoMetadata>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_all_photos(&conn).map_err(|e| format!("Failed to get photos: {}", e))
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
        let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::set_photo_favorite(&conn, &path, is_favorite).map_err(|e| format!("Failed to set favorite: {}", e))
}

#[tauri::command]
fn create_album(name: String) -> Result<i64, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::create_album(&conn, &name).map_err(|e| format!("Failed to create album: {}", e))
}

#[tauri::command]
fn delete_album(id: i64) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::delete_album(&conn, id).map_err(|e| format!("Failed to delete album: {}", e))
}

#[tauri::command]
fn get_albums() -> Result<Vec<db::Album>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_albums(&conn).map_err(|e| format!("Failed to get albums: {}", e))
}

#[tauri::command]
fn add_to_album(album_id: i64, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    for path in photo_paths {
        db::add_photo_to_album(&conn, album_id, &path).map_err(|e| format!("Failed to add to album: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn remove_from_album(album_id: i64, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    for path in photo_paths {
        db::remove_photo_from_album(&conn, album_id, &path).map_err(|e| format!("Failed to remove from album: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn get_album_photos(album_id: i64) -> Result<Vec<PhotoMetadata>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_album_photos(&conn, album_id).map_err(|e| format!("Failed to get album photos: {}", e))
}

#[tauri::command]
fn set_album_cover(album_id: i64, photo_path: String) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::set_album_cover(&conn, album_id, &photo_path).map_err(|e| format!("Failed to set album cover: {}", e))
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_duplicates(&conn).map_err(|e| format!("Failed to get duplicates: {}", e))
}

#[tauri::command]
fn search_photos(query: String) -> Result<Vec<PhotoMetadata>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::search_photos(&conn, &query).map_err(|e| format!("Failed to search photos: {}", e))
}

#[tauri::command]
fn get_locations() -> Result<Vec<(String, i64)>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_locations(&conn).map_err(|e| format!("Failed to get locations: {}", e))
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

/// Compute perceptual hash (dHash) for an image
fn compute_dhash(path: &Path) -> Option<u64> {
    let img = image::open(path).ok()?;
    let hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)  // dHash algorithm
        .hash_size(8, 8)              // 64-bit hash
        .to_hasher();

    let hash = hasher.hash_image(&img);
    // Convert hash bytes to u64
    let hash_bytes = hash.as_bytes();
    if hash_bytes.len() >= 8 {
        Some(u64::from_be_bytes([
            hash_bytes[0], hash_bytes[1], hash_bytes[2], hash_bytes[3],
            hash_bytes[4], hash_bytes[5], hash_bytes[6], hash_bytes[7],
        ]))
    } else {
        None
    }
}

/// Calculate Hamming distance between two hashes
pub(crate) fn hamming_distance(hash1: u64, hash2: u64) -> u32 {
    (hash1 ^ hash2).count_ones()
}

/// Check if an image is likely a screenshot based on heuristics
pub(crate) fn detect_screenshot(name: &str, width: u32, height: u32) -> bool {
    // Check filename patterns
    if SCREENSHOT_REGEX.is_match(name) {
        return true;
    }

    // Common screenshot dimensions (phone screens)
    let screenshot_dimensions: Vec<(u32, u32)> = vec![
        // iPhone dimensions
        (1170, 2532), (2532, 1170), // iPhone 14 Pro
        (1179, 2556), (2556, 1179), // iPhone 14 Pro Max
        (1125, 2436), (2436, 1125), // iPhone X/XS/11 Pro
        (1242, 2688), (2688, 1242), // iPhone XS Max/11 Pro Max
        (828, 1792), (1792, 828),   // iPhone XR/11
        (750, 1334), (1334, 750),   // iPhone 6/7/8
        (1080, 1920), (1920, 1080), // Common Android
        (1440, 2560), (2560, 1440), // QHD Android
        (1440, 3200), (3200, 1440), // Samsung S20/S21
        (1080, 2400), (2400, 1080), // Common Android 20:9
        // Mac/PC dimensions
        (2560, 1600), (1600, 2560), // MacBook Pro 13"
        (2880, 1800), (1800, 2880), // MacBook Pro 15"
        (3024, 1964), (1964, 3024), // MacBook Pro 14"
        (3456, 2234), (2234, 3456), // MacBook Pro 16"
        (1920, 1080), (1080, 1920), // 1080p
        (2560, 1440), (1440, 2560), // 1440p
        (3840, 2160), (2160, 3840), // 4K
    ];

    // Check if dimensions match common screenshot sizes
    if screenshot_dimensions.contains(&(width, height)) {
        return true;
    }

    // Check aspect ratios typical of phone screenshots (tall and narrow)
    if width > 0 && height > 0 {
        let aspect = if height > width {
            height as f32 / width as f32
        } else {
            width as f32 / height as f32
        };

        // Phone screenshots are typically 16:9 to 21:9 aspect ratio
        // Very tall/narrow images are likely screenshots
        if aspect > 1.9 && aspect < 2.3 {
            // Additional check: see if it matches a phone-like resolution
            let longer = height.max(width);
            let shorter = height.min(width);
            if longer >= 1800 && shorter >= 800 && shorter <= 1500 {
                return true;
            }
        }
    }

    false
}

/// COMMAND: Scan library for duplicates and compute missing hashes
#[tauri::command]
async fn scan_for_duplicates(window: tauri::Window) -> Result<ScanProgress, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_screenshots(&conn).map_err(|e| format!("Failed to get screenshots: {}", e))
}

/// COMMAND: Archive photos (move to archive folder, set archived_at)
#[tauri::command]
fn archive_photos(paths: Vec<String>) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_unreviewed_photos(&conn).map_err(|e| format!("Failed to get unreviewed photos: {}", e))
}

/// COMMAND: Mark a photo as reviewed
#[tauri::command]
fn mark_photo_reviewed(path: String) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::mark_photo_reviewed(&conn, &path).map_err(|e| format!("Failed to mark photo reviewed: {}", e))
}

/// COMMAND: Get count of unreviewed photos
#[tauri::command]
fn get_unreviewed_count() -> Result<i64, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_unreviewed_count(&conn).map_err(|e| format!("Failed to get unreviewed count: {}", e))
}

/// COMMAND: Unmark a photo as reviewed (for undo)
#[tauri::command]
fn unmark_photo_reviewed(path: String) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::unmark_photo_reviewed(&conn, &path).map_err(|e| format!("Failed to unmark photo reviewed: {}", e))
}

// ============================================================================
// Tag Commands
// ============================================================================

/// COMMAND: Create a new tag
#[tauri::command]
fn create_tag(name: String, color: String) -> Result<i64, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::create_tag(&conn, &name, &color).map_err(|e| format!("Failed to create tag: {}", e))
}

/// COMMAND: Update a tag
#[tauri::command]
fn update_tag(id: i64, name: String, color: String) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::update_tag(&conn, id, &name, &color).map_err(|e| format!("Failed to update tag: {}", e))
}

/// COMMAND: Delete a tag
#[tauri::command]
fn delete_tag(id: i64) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::delete_tag(&conn, id).map_err(|e| format!("Failed to delete tag: {}", e))
}

/// COMMAND: Get all tags
#[tauri::command]
fn get_all_tags() -> Result<Vec<db::Tag>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_all_tags(&conn).map_err(|e| format!("Failed to get tags: {}", e))
}

/// COMMAND: Get tags for a specific photo
#[tauri::command]
fn get_tags_for_photo(path: String) -> Result<Vec<db::Tag>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_tags_for_photo(&conn, &path).map_err(|e| format!("Failed to get tags for photo: {}", e))
}

/// COMMAND: Add tags to photos
#[tauri::command]
fn add_tags_to_photos(tag_ids: Vec<i64>, photo_paths: Vec<String>) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::add_tags_to_photos(&conn, &tag_ids, &photo_paths).map_err(|e| format!("Failed to add tags: {}", e))
}

/// COMMAND: Remove a tag from a photo
#[tauri::command]
fn remove_tag_from_photo(tag_id: i64, photo_path: String) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::remove_tag_from_photo(&conn, tag_id, &photo_path).map_err(|e| format!("Failed to remove tag: {}", e))
}

/// COMMAND: Get photos by tags
#[tauri::command]
fn get_photos_by_tags(tag_ids: Vec<i64>, match_all: bool) -> Result<Vec<PhotoMetadata>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_photos_by_tags(&conn, &tag_ids, match_all).map_err(|e| format!("Failed to get photos by tags: {}", e))
}

/// COMMAND: Search tags for autocomplete
#[tauri::command]
fn search_tags(query: String) -> Result<Vec<db::Tag>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::search_tags(&conn, &query).map_err(|e| format!("Failed to search tags: {}", e))
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
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::set_setting(&conn, "library_path", &path).map_err(|e| format!("Failed to set library path: {}", e))
}

/// COMMAND: Get a setting value
#[tauri::command]
fn get_setting_command(key: String) -> Result<Option<String>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    Ok(db::get_setting(&conn, &key))
}

// ============================================================================
// Smart Collections Commands
// ============================================================================

/// COMMAND: Get all smart collections with counts
#[tauri::command]
fn get_smart_collections() -> Result<Vec<db::SmartCollection>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_smart_collections(&conn).map_err(|e| format!("Failed to get smart collections: {}", e))
}

/// COMMAND: Get photos for a smart collection
#[tauri::command]
fn get_smart_collection_photos(collection_id: String) -> Result<Vec<PhotoMetadata>, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_smart_collection_photos(&conn, &collection_id).map_err(|e| format!("Failed to get collection photos: {}", e))
}

// ============================================================================
// Storage Analytics Commands
// ============================================================================

/// COMMAND: Get storage analytics
#[tauri::command]
fn get_storage_analytics() -> Result<db::StorageAnalytics, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    db::get_storage_analytics(&conn).map_err(|e| format!("Failed to get storage analytics: {}", e))
}

/// COMMAND: Populate file sizes for all photos (one-time migration)
#[tauri::command]
async fn populate_file_sizes(window: tauri::Window) -> Result<ScanProgress, String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

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
            populate_file_sizes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // ========================================================================
    // parse_exif_datetime tests
    // ========================================================================

    #[test]
    fn test_parse_exif_datetime_standard_format() {
        let result = parse_exif_datetime("2023:01:15 14:30:45");
        assert!(result.is_some());
        // Verify the timestamp corresponds to 2023-01-15 14:30:45 UTC
        let expected = chrono::NaiveDateTime::parse_from_str(
            "2023-01-15 14:30:45",
            "%Y-%m-%d %H:%M:%S",
        )
        .unwrap()
        .and_utc()
        .timestamp();
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_parse_exif_datetime_with_null_terminator() {
        let result = parse_exif_datetime("2023:01:15 14:30:45\0");
        assert!(result.is_some());
        let expected = chrono::NaiveDateTime::parse_from_str(
            "2023-01-15 14:30:45",
            "%Y-%m-%d %H:%M:%S",
        )
        .unwrap()
        .and_utc()
        .timestamp();
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_parse_exif_datetime_invalid_input() {
        assert!(parse_exif_datetime("not a date").is_none());
    }

    #[test]
    fn test_parse_exif_datetime_empty_string() {
        assert!(parse_exif_datetime("").is_none());
    }

    // ========================================================================
    // parse_filename_date tests
    // ========================================================================

    #[test]
    fn test_parse_filename_date_with_time() {
        let result = parse_filename_date("2017-11-26_030858.jpeg");
        assert!(result.is_some());
        let expected = chrono::NaiveDateTime::parse_from_str(
            "2017-11-26 03:08:58",
            "%Y-%m-%d %H:%M:%S",
        )
        .unwrap()
        .and_utc()
        .timestamp();
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_parse_filename_date_with_underscores() {
        let result = parse_filename_date("IMG_2023_06_15.jpg");
        assert!(result.is_some());
        let expected = chrono::NaiveDateTime::parse_from_str(
            "2023-06-15 00:00:00",
            "%Y-%m-%d %H:%M:%S",
        )
        .unwrap()
        .and_utc()
        .timestamp();
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_parse_filename_date_no_date() {
        assert!(parse_filename_date("random_photo.jpg").is_none());
    }

    #[test]
    fn test_parse_filename_date_year_out_of_range() {
        assert!(parse_filename_date("1800-01-01.jpg").is_none());
    }

    // ========================================================================
    // hamming_distance tests
    // ========================================================================

    #[test]
    fn test_hamming_distance_identical() {
        assert_eq!(hamming_distance(0, 0), 0);
    }

    #[test]
    fn test_hamming_distance_one_bit() {
        assert_eq!(hamming_distance(0, 1), 1);
    }

    #[test]
    fn test_hamming_distance_all_different() {
        assert_eq!(hamming_distance(0, u64::MAX), 64);
    }

    #[test]
    fn test_hamming_distance_threshold_boundary() {
        // 0b1111111111 has exactly 10 bits set, so distance from 0 is 10
        let hash_with_10_bits: u64 = 0b1111111111;
        assert_eq!(hamming_distance(0, hash_with_10_bits), 10);
    }

    // ========================================================================
    // detect_screenshot tests
    // ========================================================================

    #[test]
    fn test_detect_screenshot_by_filename_lowercase() {
        assert!(detect_screenshot("screenshot_2023.png", 800, 600));
    }

    #[test]
    fn test_detect_screenshot_by_filename_screen_shot() {
        assert!(detect_screenshot("Screen Shot 2023.png", 800, 600));
    }

    #[test]
    fn test_detect_screenshot_by_filename_capture() {
        assert!(detect_screenshot("capture_01.png", 800, 600));
    }

    #[test]
    fn test_detect_screenshot_by_iphone_dimensions() {
        assert!(detect_screenshot("IMG_0001.png", 1170, 2532));
    }

    #[test]
    fn test_detect_screenshot_by_mac_dimensions() {
        assert!(detect_screenshot("IMG_0002.png", 2560, 1600));
    }

    #[test]
    fn test_detect_screenshot_normal_photo_dimensions() {
        assert!(!detect_screenshot("photo.jpg", 4000, 3000));
    }

    #[test]
    fn test_detect_screenshot_normal_photo_name_normal_dims() {
        assert!(!detect_screenshot("vacation_trip.jpg", 3024, 4032));
    }

    // ========================================================================
    // is_video tests
    // ========================================================================

    #[test]
    fn test_is_video_mp4() {
        assert!(is_video(Path::new("video.mp4")));
    }

    #[test]
    fn test_is_video_mov_uppercase() {
        assert!(is_video(Path::new("clip.MOV")));
    }

    #[test]
    fn test_is_video_jpg_not_video() {
        assert!(!is_video(Path::new("photo.jpg")));
    }

    #[test]
    fn test_is_video_no_extension() {
        assert!(!is_video(Path::new("noextension")));
    }
}
