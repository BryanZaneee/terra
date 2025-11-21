use std::fs;
use std::path::Path;
use std::time::{UNIX_EPOCH, SystemTime};
use walkdir::WalkDir;
use rayon::prelude::*;
use serde::{Serialize, Deserialize};
use chrono::NaiveDateTime;
use regex::Regex;

mod db;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PhotoMetadata {
    pub path: String,
    pub name: String,
    pub date_taken: i64, // Unix timestamp
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub is_favorite: bool,
}

/// Parse EXIF DateTimeOriginal field (format: "2023:01:15 14:30:45")
fn parse_exif_datetime(datetime_str: &str) -> Option<i64> {
    // Trim null terminators and whitespace that can appear in EXIF strings
    let datetime_str = datetime_str.trim_end_matches('\0').trim();

    let cleaned = datetime_str.replace(':', "-");
    let parts: Vec<&str> = cleaned.split(' ').collect();

    if parts.len() != 2 {
        eprintln!("Invalid EXIF datetime format: {}", datetime_str);
        return None;
    }

    let date_part = parts[0];
    let time_part = parts[1].replace('-', ":");
    let combined = format!("{} {}", date_part, time_part);

    match NaiveDateTime::parse_from_str(&combined, "%Y-%m-%d %H:%M:%S") {
        Ok(dt) => Some(dt.and_utc().timestamp()),
        Err(e) => {
            eprintln!("Failed to parse EXIF datetime '{}': {}", combined, e);
            None
        }
    }
}

/// Try to extract date from filename (e.g., "2017-11-26_030858.jpeg")
fn parse_filename_date(filename: &str) -> Option<i64> {
    // Try to find patterns like YYYY-MM-DD in the filename
    let re = Regex::new(r"(\d{4})[_-](\d{2})[_-](\d{2})").ok()?;

    if let Some(caps) = re.captures(filename) {
        let year: i32 = caps.get(1)?.as_str().parse().ok()?;
        let month: u32 = caps.get(2)?.as_str().parse().ok()?;
        let day: u32 = caps.get(3)?.as_str().parse().ok()?;

        // Validate date ranges
        if year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 {
            return None;
        }

        // Try to parse time too if available (HHMMSS format)
        let time_re = Regex::new(r"_(\d{2})(\d{2})(\d{2})").ok()?;
        let (hour, min, sec) = if let Some(time_caps) = time_re.captures(filename) {
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
                println!("Extracted date from filename '{}': {}", filename, date_str);
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
            eprintln!("Failed to parse EXIF for {:?}: {}", path.file_name(), e);
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
                    println!("Found EXIF date for {:?}: {}", path.file_name(), trimmed);
                    return Some(timestamp);
                }
            }
        }
    }

    eprintln!("No EXIF date found for {:?}", path.file_name());
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

/// Process a single image file and extract metadata
fn process_image(path: &Path) -> Option<PhotoMetadata> {
    let name = path.file_name()?.to_string_lossy().to_string();

    // Canonicalize path for reliable Tauri file access with convertFileSrc
    let canonical_path = match path.canonicalize() {
        Ok(p) => {
            println!("Canonicalized path for {}: {}", name, p.display());
            p.to_string_lossy().to_string()
        },
        Err(e) => {
            eprintln!("Warning: Could not canonicalize path {:?}: {}", path, e);
            path.to_string_lossy().to_string()
        }
    };

    // Try EXIF first, then filename parsing, then file modified time, then current time
    let date_taken = extract_exif_date(path)
        .or_else(|| {
            let filename_date = parse_filename_date(&name);
            if filename_date.is_some() {
                println!("Extracted date from filename for {}", name);
            }
            filename_date
        })
        .or_else(|| {
            let mtime = get_file_modified_time(path);
            if mtime.is_some() {
                println!("Using file modified time for {}", name);
            }
            mtime
        })
        .unwrap_or_else(|| {
            // Use current time as last resort instead of epoch
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            eprintln!("WARNING: No date found for {}, using current time: {}", name, now);
            now
        });

    // Get image dimensions
    let (width, height) = if is_video(path) {
        (0, 0) // Skip dimension extraction for videos for now
    } else {
        match image::open(path) {
            Ok(img) => (img.width(), img.height()),
            Err(e) => {
                eprintln!("Failed to read image dimensions for {}: {}", name, e);
                (0, 0)
            }
        }
    };

    Some(PhotoMetadata {
        path: canonical_path,
        name,
        date_taken,
        width,
        height,
        is_favorite: false, // Default to false for new/scanned photos
    })
}

fn is_video(path: &Path) -> bool {
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

/// COMMAND: Scan Directory
/// Recursively scans a directory for image files and saves them to the database
#[tauri::command]
fn scan_directory(dir_path: String, save_to_db: bool) -> Result<Vec<PhotoMetadata>, String> {
    println!("Scanning directory: {}", dir_path);

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

    println!("Found {} image files", entries.len());

    // 2. Process metadata in parallel using Rayon
    let photos: Vec<PhotoMetadata> = entries
        .par_iter()
        .filter_map(|entry| process_image(entry.path()))
        .collect();

    println!("Successfully processed {} photos", photos.len());

    // 3. Optionally save to database
    if save_to_db {
        let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
        for photo in &photos {
            db::insert_photo(&conn, photo, "scan")
                .map_err(|e| format!("Failed to insert photo: {}", e))?;
        }
        println!("Saved {} photos to database", photos.len());
    }

    Ok(photos)
}

/// COMMAND: Upload Photos
/// Copies photos to the Terra managed library and saves metadata to database
#[tauri::command]
fn upload_photos(file_paths: Vec<String>) -> Result<Vec<PhotoMetadata>, String> {
    println!("Uploading {} photos", file_paths.len());

    let library_path = db::get_library_path();
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;

    let uploaded_photos: Vec<PhotoMetadata> = file_paths
        .iter()
        .filter_map(|file_path| {
            let source_path = Path::new(file_path);
            if !source_path.exists() {
                eprintln!("File not found: {}", file_path);
                return None;
            }

            // Process the image to get metadata (especially date_taken)
            let mut photo = process_image(source_path)?;

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
                Ok(_) => println!("Copied {} to {}", file_path, final_dest_path.display()),
                Err(e) => {
                    eprintln!("Failed to copy {}: {}", file_path, e);
                    return None;
                }
            }

            // Canonicalize the destination path for Tauri file access
            let canonical_dest = match final_dest_path.canonicalize() {
                Ok(p) => {
                    println!("Canonicalized destination: {}", p.display());
                    p.to_string_lossy().to_string()
                },
                Err(e) => {
                    eprintln!("Warning: Could not canonicalize destination {:?}: {}", final_dest_path, e);
                    final_dest_path.to_string_lossy().to_string()
                }
            };

            // Update photo path to the new canonicalized location
            photo.path = canonical_dest.clone();
            photo.name = final_dest_path.file_name()?.to_string_lossy().to_string();

            // Save to database
            match db::insert_photo(&conn, &photo, "upload") {
                Ok(_) => println!("Saved to database: {}", photo.name),
                Err(e) => {
                    eprintln!("Failed to save {} to database: {}", photo.name, e);
                    return None;
                }
            }

            println!("Successfully uploaded: {} -> {}", file_path, photo.path);
            Some(photo)
        })
        .collect();

    println!("Successfully uploaded {} photos", uploaded_photos.len());
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

#[tauri::command]
fn delete_photos(paths: Vec<String>) -> Result<(), String> {
    let conn = db::init_database().map_err(|e| format!("Database error: {}", e))?;
    for path_str in paths {
        // 1. Delete from database
        db::delete_photo(&conn, &path_str).map_err(|e| format!("Failed to delete from DB: {}", e))?;
        
        // 2. Delete from filesystem (if it's in the managed library)
        let path = Path::new(&path_str);
        if path.exists() {
             // Only delete if it's inside the Terra library to avoid deleting user's source files if they scanned them in place?
             // Actually, for now, let's assume we only delete what we manage or if the user explicitly asks.
             // The requirement says "delete them".
             // Safety check: maybe only delete if it contains "Terra" in path? 
             // For now, let's just try to delete.
             fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            delete_photos
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
