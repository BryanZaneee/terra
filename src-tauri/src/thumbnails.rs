use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;

use crate::media;

pub const THUMB_SIZE: u32 = 256;
const JPEG_QUALITY: u8 = 80;

/// Root directory for the on-disk thumbnail cache.
/// Lives under the same Terra data dir as the SQLite DB.
pub fn thumb_cache_root() -> PathBuf {
    let mut path = dirs::data_local_dir().expect("Failed to get local data directory");
    path.push("terra");
    path.push("thumbs");
    let _ = fs::create_dir_all(&path);
    path
}

/// Canonical path for a thumbnail of a given content hash + size.
/// Content-addressed so the cache survives library re-organizations.
/// Layout: `<root>/<size>/<hash[0..2]>/<hash>.jpg`
pub fn thumb_path(content_hash: &str, size: u32) -> PathBuf {
    let mut path = thumb_cache_root();
    path.push(size.to_string());
    let prefix = if content_hash.len() >= 2 { &content_hash[..2] } else { content_hash };
    path.push(prefix);
    let _ = fs::create_dir_all(&path);
    path.push(format!("{}.jpg", content_hash));
    path
}

/// Generate a thumbnail for one image and write it to the cache.
/// Returns the destination path. Idempotent: if the thumbnail already exists, returns immediately.
/// Videos are unsupported here; callers should detect them and skip.
pub fn generate_thumbnail(source: &Path, content_hash: &str, size: u32) -> Result<PathBuf, String> {
    let dest = thumb_path(content_hash, size);
    if dest.exists() {
        return Ok(dest);
    }

    if media::is_video(source) {
        return Err(format!("video thumbnails not implemented: {}", source.display()));
    }

    let reader = ImageReader::open(source)
        .map_err(|e| format!("failed to open {}: {}", source.display(), e))?
        .with_guessed_format()
        .map_err(|e| format!("failed to detect format: {}", e))?;
    let img = reader
        .decode()
        .map_err(|e| format!("failed to decode {}: {}", source.display(), e))?;

    let resized = img.thumbnail(size, size);

    let mut out = fs::File::create(&dest)
        .map_err(|e| format!("failed to create {}: {}", dest.display(), e))?;
    let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode_image(&resized)
        .map_err(|e| format!("failed to encode JPEG: {}", e))?;

    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn thumb_path_is_content_addressed_with_two_char_prefix() {
        let p = thumb_path("abc123def456", 256);
        let s = p.to_string_lossy();
        assert!(s.contains("/256/ab/"));
        assert!(s.ends_with("abc123def456.jpg"));
    }

    #[test]
    fn thumb_path_handles_short_hash() {
        let p = thumb_path("a", 256);
        assert!(p.to_string_lossy().contains("/256/a/"));
    }

    #[test]
    fn generate_thumbnail_writes_jpeg_for_image() {
        let tmp = std::env::temp_dir().join(format!("terra-thumb-test-{}.png", std::process::id()));
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(800, 600, Rgb([200, 50, 100]));
        img.save(&tmp).expect("write source image");

        let hash = "test_thumb_smoke_0123456789";
        let dest = generate_thumbnail(&tmp, hash, 256).expect("thumb generated");

        assert!(dest.exists());
        let decoded = ImageReader::open(&dest).unwrap().decode().unwrap();
        assert!(decoded.width() <= 256 && decoded.height() <= 256);

        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn generate_thumbnail_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("terra-thumb-idem-{}.png", std::process::id()));
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_pixel(100, 100, Rgb([0, 0, 0]));
        img.save(&tmp).unwrap();

        let hash = "test_thumb_idem_aaaaaaaaaa";
        let first = generate_thumbnail(&tmp, hash, 256).unwrap();
        let modified_first = fs::metadata(&first).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = generate_thumbnail(&tmp, hash, 256).unwrap();
        let modified_second = fs::metadata(&second).unwrap().modified().unwrap();

        assert_eq!(first, second);
        assert_eq!(modified_first, modified_second);

        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&first);
    }

    #[test]
    fn generate_thumbnail_rejects_videos() {
        let tmp = std::env::temp_dir().join(format!("terra-thumb-vid-{}.mp4", std::process::id()));
        fs::write(&tmp, b"not really a video").unwrap();
        let err = generate_thumbnail(&tmp, "x", 256).unwrap_err();
        assert!(err.contains("video"));
        let _ = fs::remove_file(&tmp);
    }
}
