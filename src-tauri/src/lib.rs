use std::fs;
use std::time::{UNIX_EPOCH, SystemTime};
use walkdir::WalkDir;
use rayon::prelude::*;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, NaiveDateTime};

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

/// COMMAND: Scan Directory
/// Recursively scans a directory for image files and extracts metadata
#[tauri::command]
pub async fn scan_directory(dir_path: String) -> Result<Vec<PhotoMetadata>, String> {
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
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();

            // Try EXIF first, fallback to File Modified Date
            let mut date_taken: i64 = 0;

            // Attempt to read EXIF data
            if let Ok(file) = fs::File::open(path) {
                let mut bufreader = std::io::BufReader::new(&file);
                if let Ok(exif_reader) = kamadak_exif::Reader::new().read_from_container(&mut bufreader) {
                    // Try DateTimeOriginal first (most accurate)
                    if let Some(field) = exif_reader.get_field(kamadak_exif::Tag::DateTimeOriginal, kamadak_exif::In::PRIMARY) {
                        if let Some(timestamp) = parse_exif_datetime(&field.display_value().to_string()) {
                            date_taken = timestamp;
                        }
                    }

                    // Fallback to DateTime if DateTimeOriginal not found
                    if date_taken == 0 {
                        if let Some(field) = exif_reader.get_field(kamadak_exif::Tag::DateTime, kamadak_exif::In::PRIMARY) {
                            if let Some(timestamp) = parse_exif_datetime(&field.display_value().to_string()) {
                                date_taken = timestamp;
                            }
                        }
                    }
                }
            }

            // Fallback to file modified time if EXIF not available
            if date_taken == 0 {
                if let Ok(metadata) = fs::metadata(path) {
                    if let Ok(modified) = metadata.modified() {
                        date_taken = modified
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                    }
                }
            }

            // Get image dimensions (optional, can be slow for large images)
            let (width, height) = if let Ok(img) = image::open(path) {
                (img.width(), img.height())
            } else {
                (0, 0)
            };

            Some(PhotoMetadata {
                path: path.to_string_lossy().to_string(),
                name,
                date_taken,
                width,
                height,
            })
        })
        .collect();

    println!("Successfully processed {} photos", photos.len());
    Ok(photos)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![scan_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
