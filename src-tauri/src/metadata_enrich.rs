/// metadata_enrich.rs -- call scripts/extract_metadata.py via python3 subprocess
/// and return structured metadata for a single photo path.
///
/// The python script requires exiftool in PATH. If either is absent the functions
/// return Err with an actionable message rather than panicking.
///
/// Subprocess tests are intentionally omitted from this file because they require
/// python3 + exiftool in the test environment. Integration is verified at runtime.

use serde::Deserialize;
use std::process::Command;

/// Enriched metadata returned by the Python extraction script.
/// All fields are Option<T>; absent metadata from exiftool is represented as None.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct EnrichedMetadata {
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub iso: Option<i32>,
    pub aperture: Option<f64>,
    pub shutter_us: Option<i64>,
    pub focal_length_mm: Option<f64>,
    pub orientation: Option<i32>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
}

/// Internal representation of the script's full output.
#[derive(Debug, Deserialize)]
struct ScriptOutput {
    ok: bool,
    error: Option<String>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_model: Option<String>,
    iso: Option<i32>,
    aperture: Option<f64>,
    shutter_us: Option<i64>,
    focal_length_mm: Option<f64>,
    orientation: Option<i32>,
    duration_ms: Option<i64>,
    codec: Option<String>,
}

/// Resolve the path to extract_metadata.py.
///
/// Production: resolved via the Tauri resource directory.
/// Development fallback: path relative to CARGO_MANIFEST_DIR compiled in at build time.
fn script_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    // Try resource directory first (production bundle).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("scripts").join("extract_metadata.py");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // Fall back to the source tree path baked in at compile time.
    let dev_path = std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../scripts/extract_metadata.py"
    ));
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "extract_metadata.py not found. Expected in app resources or at {}",
        dev_path.display()
    ))
}

/// Run the Python extraction script for a single photo path.
/// Returns Err if python3 is not found, the script is missing, or the script
/// reports ok=false.
pub fn enrich_path(app: &tauri::AppHandle, path: &str) -> Result<EnrichedMetadata, String> {
    let script = script_path(app)?;

    let output = Command::new("python3")
        .arg(&script)
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to launch python3: {}. Ensure python3 is in PATH.", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: ScriptOutput = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse script output: {}. Raw: {}", e, stdout.trim()))?;

    if !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| "extract_metadata.py returned ok=false".into()));
    }

    Ok(EnrichedMetadata {
        camera_make: parsed.camera_make,
        camera_model: parsed.camera_model,
        lens_model: parsed.lens_model,
        iso: parsed.iso,
        aperture: parsed.aperture,
        shutter_us: parsed.shutter_us,
        focal_length_mm: parsed.focal_length_mm,
        orientation: parsed.orientation,
        duration_ms: parsed.duration_ms,
        codec: parsed.codec,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Subprocess tests are skipped here -- they require python3 + exiftool in the
    // test environment, which is not guaranteed in CI. Runtime behavior is verified
    // via the integration commands (enrich_photo_metadata / enrich_all_metadata).

    #[test]
    fn test_valid_json_parses_into_enriched_metadata() {
        let json = r#"{
            "path": "/photos/test.jpg",
            "ok": true,
            "camera_make": "Apple",
            "camera_model": "iPhone 15 Pro",
            "lens_model": "iPhone 15 Pro back camera 6.86mm f/1.78",
            "iso": 64,
            "aperture": 1.78,
            "shutter_us": 16667,
            "focal_length_mm": 6.86,
            "orientation": 1,
            "duration_ms": null,
            "codec": null
        }"#;

        let parsed: ScriptOutput = serde_json::from_str(json).expect("parse failed");
        assert!(parsed.ok);
        assert_eq!(parsed.camera_make.as_deref(), Some("Apple"));
        assert_eq!(parsed.camera_model.as_deref(), Some("iPhone 15 Pro"));
        assert_eq!(parsed.iso, Some(64));
        assert!((parsed.aperture.unwrap() - 1.78).abs() < 0.001);
        assert_eq!(parsed.shutter_us, Some(16667));
        assert!(parsed.duration_ms.is_none());
        assert!(parsed.codec.is_none());
    }

    #[test]
    fn test_error_json_is_mapped_to_err() {
        let json = r#"{
            "path": "/photos/test.jpg",
            "ok": false,
            "error": "exiftool not found in PATH; install with `brew install exiftool`"
        }"#;

        let parsed: ScriptOutput = serde_json::from_str(json).expect("parse failed");
        assert!(!parsed.ok);
        assert!(parsed.error.as_deref().unwrap().contains("exiftool"));
    }

    #[test]
    fn test_all_null_fields_parse_without_error() {
        let json = r#"{
            "path": "/photos/bare.jpg",
            "ok": true,
            "camera_make": null,
            "camera_model": null,
            "lens_model": null,
            "iso": null,
            "aperture": null,
            "shutter_us": null,
            "focal_length_mm": null,
            "orientation": null,
            "duration_ms": null,
            "codec": null
        }"#;

        let parsed: ScriptOutput = serde_json::from_str(json).expect("parse failed");
        assert!(parsed.ok);
        assert!(parsed.camera_make.is_none());
        assert!(parsed.iso.is_none());
        assert!(parsed.codec.is_none());
    }
}
