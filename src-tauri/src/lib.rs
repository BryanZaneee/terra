use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;
use rayon::prelude::*;
use serde::{Serialize, Deserialize};
use chrono::NaiveDateTime;

mod db;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PhotoMetadata {
    pub path: String,
    pub name: String,
    pub date_taken: i64, // Unix timestamp
    pub width: u32,
    pub height: u32,
}

/// Parse EXIF DateTimeOriginal field (format: "2023:01:15 14:30:45")
fn parse_exif_datetime(datetime_str: &str) -> Option<i64> {
    let cleaned = datetime_str.replace(':', "-");
    let parts: Vec<&str> = cleaned.split(' ').collect();

    if parts.len() != 2 {
        return None;
    }

    let date_part = parts[0];
    let time_part = parts[1].replace('-', ":");
    let combined = format!("{} {}", date_part, time_part);

    NaiveDateTime::parse_from_str(&combined, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|dt| dt.and_utc().timestamp())
}

/// Extract EXIF metadata from an image file
fn extract_exif_date(path: &Path) -> Option<i64> {
    let exif_data = rexif::parse_file(path).ok()?;

    // Try DateTimeOriginal first (most accurate for photos)
    for entry in &exif_data.entries {
        if entry.tag == rexif::ExifTag::DateTimeOriginal || entry.tag == rexif::ExifTag::DateTime {
            if let rexif::TagValue::Ascii(ref s) = entry.value {
                if let Some(timestamp) = parse_exif_datetime(s) {
                    return Some(timestamp);
                }
            }
        }
    }

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

    // Try EXIF first, fallback to file modified time
    let date_taken = extract_exif_date(path)
        .or_else(|| get_file_modified_time(path))
        .unwrap_or(0);

    // Get image dimensions
    let (width, height) = image::open(path)
        .map(|img| (img.width(), img.height()))
        .unwrap_or((0, 0));

    Some(PhotoMetadata {
        path: path.to_string_lossy().to_string(),
        name,
        date_taken,
        width,
        height,
    })
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
            matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "heic" | "webp" | "gif" | "bmp")
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
            fs::copy(source_path, &final_dest_path).ok()?;

            // Update photo path to the new location
            photo.path = final_dest_path.to_string_lossy().to_string();
            photo.name = final_dest_path.file_name()?.to_string_lossy().to_string();

            // Save to database
            db::insert_photo(&conn, &photo, "upload").ok()?;

            println!("Uploaded: {} -> {}", file_path, photo.path);
            Some(photo)
        })
        .collect();

    println!("Successfully uploaded {} photos", uploaded_photos.len());
    Ok(uploaded_photos)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            get_all_photos,
            upload_photos
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
