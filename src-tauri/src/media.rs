//! Pure media processing helpers: EXIF parsing, hashing, GPS extraction,
//! screenshot heuristics, perceptual hashing. No database access.
//!
//! Functions here are called from Tauri commands in `lib.rs`. They take file
//! paths (or already-decoded data) and return owned values; nothing in this
//! module depends on the SQLite layer.

use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::NaiveDateTime;
use image_hasher::{HashAlg, HasherConfig};
use lazy_static::lazy_static;
use log::{debug, warn};
use regex::Regex;
use reverse_geocoder::{Locations, ReverseGeocoder};
use sha2::{Digest, Sha256};

use crate::config;
use crate::PhotoMetadata;

// Cached regexes and reverse-geocoder data. Building the geocoder requires
// loading the world city database; doing it once at startup pays for itself
// after the first photo.
lazy_static! {
    static ref DATE_REGEX: Regex = Regex::new(r"(\d{4})[_-](\d{2})[_-](\d{2})").unwrap();
    static ref TIME_REGEX: Regex = Regex::new(r"_(\d{2})(\d{2})(\d{2})").unwrap();
    pub(crate) static ref GEOCODER_LOCATIONS: Locations = Locations::from_memory();
    static ref SCREENSHOT_REGEX: Regex =
        Regex::new(r"(?i)(screenshot|screen[\s_-]?shot|capture|snip|grab)").unwrap();
}

// Common phone/laptop screenshot dimensions. Hardcoded because the list
// rarely changes and a config file would be more friction than it's worth.
const SCREENSHOT_DIMENSIONS: &[(u32, u32)] = &[
    // iPhone
    (1170, 2532), (2532, 1170), // 14 Pro
    (1179, 2556), (2556, 1179), // 14 Pro Max
    (1125, 2436), (2436, 1125), // X / XS / 11 Pro
    (1242, 2688), (2688, 1242), // XS Max / 11 Pro Max
    (828, 1792),  (1792, 828),  // XR / 11
    (750, 1334),  (1334, 750),  // 6 / 7 / 8
    // Android
    (1080, 1920), (1920, 1080), // common
    (1440, 2560), (2560, 1440), // QHD
    (1440, 3200), (3200, 1440), // S20 / S21
    (1080, 2400), (2400, 1080), // 20:9
    // Mac / PC
    (2560, 1600), (1600, 2560), // MBP 13"
    (2880, 1800), (1800, 2880), // MBP 15"
    (3024, 1964), (1964, 3024), // MBP 14"
    (3456, 2234), (2234, 3456), // MBP 16"
    (3840, 2160), (2160, 3840), // 4K
];

/// Parse an EXIF DateTimeOriginal field (format: `2023:01:15 14:30:45`).
pub(crate) fn parse_exif_datetime(datetime_str: &str) -> Option<i64> {
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

/// Try to extract a date from a filename like `2017-11-26_030858.jpeg`.
pub(crate) fn parse_filename_date(filename: &str) -> Option<i64> {
    let caps = DATE_REGEX.captures(filename)?;
    let year: i32 = caps.get(1)?.as_str().parse().ok()?;
    let month: u32 = caps.get(2)?.as_str().parse().ok()?;
    let day: u32 = caps.get(3)?.as_str().parse().ok()?;

    if year < config::MIN_VALID_YEAR
        || year > config::MAX_VALID_YEAR
        || month < 1
        || month > 12
        || day < 1
        || day > 31
    {
        return None;
    }

    let (hour, min, sec) = if let Some(time_caps) = TIME_REGEX.captures(filename) {
        (
            time_caps.get(1)?.as_str().parse().ok()?,
            time_caps.get(2)?.as_str().parse().ok()?,
            time_caps.get(3)?.as_str().parse().ok()?,
        )
    } else {
        (0, 0, 0)
    };

    let date_str = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        year, month, day, hour, min, sec
    );
    NaiveDateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|dt| {
            debug!("Extracted date from filename '{}': {}", filename, date_str);
            dt.and_utc().timestamp()
        })
}

fn extract_exif_date(path: &Path) -> Option<i64> {
    let exif_data = match rexif::parse_file(path) {
        Ok(data) => data,
        Err(e) => {
            debug!("Failed to parse EXIF for {:?}: {}", path.file_name(), e);
            return None;
        }
    };

    for entry in &exif_data.entries {
        if entry.tag == rexif::ExifTag::DateTimeOriginal || entry.tag == rexif::ExifTag::DateTime {
            if let rexif::TagValue::Ascii(ref s) = entry.value {
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

fn get_file_modified_time(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

fn calculate_hash(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 1024 * 1024];

    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Some(hex::encode(hasher.finalize()))
}

fn extract_gps(path: &Path) -> Option<(f64, f64)> {
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown");
    let exif_data = rexif::parse_file(path).ok()?;

    let mut lat: Option<f64> = None;
    let mut lon: Option<f64> = None;
    let mut lat_ref = 1.0;
    let mut lon_ref = 1.0;

    for entry in &exif_data.entries {
        match entry.tag {
            rexif::ExifTag::GPSLatitude => {
                if let rexif::TagValue::URational(ref values) = entry.value {
                    if values.len() == 3 {
                        lat = Some(
                            values[0].value()
                                + values[1].value() / 60.0
                                + values[2].value() / 3600.0,
                        );
                    }
                }
            }
            rexif::ExifTag::GPSLongitude => {
                if let rexif::TagValue::URational(ref values) = entry.value {
                    if values.len() == 3 {
                        lon = Some(
                            values[0].value()
                                + values[1].value() / 60.0
                                + values[2].value() / 3600.0,
                        );
                    }
                }
            }
            rexif::ExifTag::GPSLatitudeRef => {
                if let rexif::TagValue::Ascii(ref s) = entry.value {
                    if s.starts_with('S') {
                        lat_ref = -1.0;
                    }
                }
            }
            rexif::ExifTag::GPSLongitudeRef => {
                if let rexif::TagValue::Ascii(ref s) = entry.value {
                    if s.starts_with('W') {
                        lon_ref = -1.0;
                    }
                }
            }
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

fn get_location_name(lat: f64, lon: f64, geocoder: &ReverseGeocoder) -> Option<String> {
    let search_result = geocoder.search((lat, lon))?;
    let location = format!("{}, {}", search_result.record.name, search_result.record.admin1);
    debug!("Reverse geocoded ({}, {}) -> {}", lat, lon, location);
    Some(location)
}

/// Read an image file and produce a `PhotoMetadata` record.
///
/// Date extraction tries (in order): EXIF DateTimeOriginal → filename
/// pattern → file modified time → current time. Width/height are decoded
/// from the image header for photos and left as `0,0` for videos.
pub(crate) fn process_image(path: &Path, geocoder: Option<&ReverseGeocoder>) -> Option<PhotoMetadata> {
    let name = path.file_name()?.to_string_lossy().to_string();

    let canonical_path = match path.canonicalize() {
        Ok(p) => {
            debug!("Canonicalized path for {}: {}", name, p.display());
            p.to_string_lossy().to_string()
        }
        Err(e) => {
            warn!("Could not canonicalize path {:?}: {}", path, e);
            path.to_string_lossy().to_string()
        }
    };

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
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            warn!("No date found for {}, using current time: {}", name, now);
            now
        });

    let (width, height) = if is_video(path) {
        (0, 0)
    } else {
        match image::open(path) {
            Ok(img) => (img.width(), img.height()),
            Err(e) => {
                warn!("Failed to read image dimensions for {}: {}", name, e);
                (0, 0)
            }
        }
    };

    let content_hash = calculate_hash(path);

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
        is_favorite: false,
        content_hash,
        latitude,
        longitude,
        location_name,
        camera_make: None,
        camera_model: None,
        lens_model: None,
        iso: None,
        aperture: None,
        shutter_us: None,
        focal_length_mm: None,
        orientation: None,
        duration_ms: None,
        codec: None,
        thumb_status: None,
    })
}

pub(crate) fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "mp4" | "mov" | "avi" | "webm" | "mkv"))
        .unwrap_or(false)
}

/// Compute a 64-bit perceptual hash (dHash) for an image. Used for similar-
/// duplicate detection via Hamming distance.
pub(crate) fn compute_dhash(path: &Path) -> Option<u64> {
    let img = image::open(path).ok()?;
    let hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)
        .hash_size(8, 8)
        .to_hasher();

    let hash = hasher.hash_image(&img);
    let bytes = hash.as_bytes();
    if bytes.len() >= 8 {
        Some(u64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    } else {
        None
    }
}

/// Number of differing bits between two 64-bit hashes.
pub(crate) fn hamming_distance(hash1: u64, hash2: u64) -> u32 {
    (hash1 ^ hash2).count_ones()
}

/// Heuristic test for whether an image is likely a screenshot.
/// Combines filename patterns, exact-dimension match against common phone /
/// laptop screen sizes, and a tall-aspect-ratio fallback.
pub(crate) fn detect_screenshot(name: &str, width: u32, height: u32) -> bool {
    if SCREENSHOT_REGEX.is_match(name) {
        return true;
    }

    if SCREENSHOT_DIMENSIONS.contains(&(width, height)) {
        return true;
    }

    if width > 0 && height > 0 {
        let aspect = if height > width {
            height as f32 / width as f32
        } else {
            width as f32 / height as f32
        };

        // Phone screenshots are roughly 16:9 to 21:9.
        if aspect > 1.9 && aspect < 2.3 {
            let longer = height.max(width);
            let shorter = height.min(width);
            if longer >= 1800 && shorter >= 800 && shorter <= 1500 {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // parse_exif_datetime

    #[test]
    fn parses_standard_format() {
        let result = parse_exif_datetime("2023:01:15 14:30:45");
        let expected = NaiveDateTime::parse_from_str("2023-01-15 14:30:45", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
            .timestamp();
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn parses_with_null_terminator() {
        let result = parse_exif_datetime("2023:01:15 14:30:45\0");
        let expected = NaiveDateTime::parse_from_str("2023-01-15 14:30:45", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
            .timestamp();
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(parse_exif_datetime("not a date").is_none());
    }

    #[test]
    fn rejects_empty_string() {
        assert!(parse_exif_datetime("").is_none());
    }

    // parse_filename_date

    #[test]
    fn parses_filename_with_time() {
        let result = parse_filename_date("2017-11-26_030858.jpeg");
        let expected = NaiveDateTime::parse_from_str("2017-11-26 03:08:58", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
            .timestamp();
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn parses_filename_with_underscores() {
        let result = parse_filename_date("IMG_2023_06_15.jpg");
        let expected = NaiveDateTime::parse_from_str("2023-06-15 00:00:00", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
            .timestamp();
        assert_eq!(result, Some(expected));
    }

    #[test]
    fn rejects_filename_without_date() {
        assert!(parse_filename_date("random_photo.jpg").is_none());
    }

    #[test]
    fn rejects_filename_year_out_of_range() {
        assert!(parse_filename_date("1800-01-01.jpg").is_none());
    }

    // hamming_distance

    #[test]
    fn hamming_identical_is_zero() {
        assert_eq!(hamming_distance(0, 0), 0);
    }

    #[test]
    fn hamming_one_bit_difference() {
        assert_eq!(hamming_distance(0, 1), 1);
    }

    #[test]
    fn hamming_all_different_is_64() {
        assert_eq!(hamming_distance(0, u64::MAX), 64);
    }

    #[test]
    fn hamming_threshold_boundary() {
        let hash_with_10_bits: u64 = 0b1111111111;
        assert_eq!(hamming_distance(0, hash_with_10_bits), 10);
    }

    // detect_screenshot

    #[test]
    fn screenshot_by_filename_lowercase() {
        assert!(detect_screenshot("screenshot_2023.png", 800, 600));
    }

    #[test]
    fn screenshot_by_filename_screen_shot() {
        assert!(detect_screenshot("Screen Shot 2023.png", 800, 600));
    }

    #[test]
    fn screenshot_by_filename_capture() {
        assert!(detect_screenshot("capture_01.png", 800, 600));
    }

    #[test]
    fn screenshot_by_iphone_dimensions() {
        assert!(detect_screenshot("IMG_0001.png", 1170, 2532));
    }

    #[test]
    fn screenshot_by_mac_dimensions() {
        assert!(detect_screenshot("IMG_0002.png", 2560, 1600));
    }

    #[test]
    fn normal_photo_not_screenshot() {
        assert!(!detect_screenshot("photo.jpg", 4000, 3000));
    }

    #[test]
    fn portrait_photo_not_screenshot() {
        assert!(!detect_screenshot("vacation_trip.jpg", 3024, 4032));
    }

    // is_video

    #[test]
    fn mp4_is_video() {
        assert!(is_video(Path::new("video.mp4")));
    }

    #[test]
    fn mov_uppercase_is_video() {
        assert!(is_video(Path::new("clip.MOV")));
    }

    #[test]
    fn jpg_is_not_video() {
        assert!(!is_video(Path::new("photo.jpg")));
    }

    #[test]
    fn no_extension_is_not_video() {
        assert!(!is_video(Path::new("noextension")));
    }
}
