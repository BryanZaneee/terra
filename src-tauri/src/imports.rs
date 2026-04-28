//! Local provider-export discovery for cloud/social imports.
//!
//! Providers do not all expose safe full-library OAuth APIs, so Terra's first
//! durable import path is: guide the user to download an export, then ingest
//! the local folder or ZIP through the same managed-library pipeline.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;
use zip::ZipArchive;

const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "webp", "gif", "bmp",
    "mp4", "mov", "avi", "webm", "mkv",
];

const IGNORED_EXPORT_EXTENSIONS: &[&str] = &[
    "json", "html", "htm", "csv", "txt", "md", "xml", "ini",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportProvider {
    IcloudPhotos,
    GooglePhotos,
    Snapchat,
    LocalExport,
}

impl ImportProvider {
    pub fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "icloud_photos" => Ok(Self::IcloudPhotos),
            "google_photos" => Ok(Self::GooglePhotos),
            "snapchat" => Ok(Self::Snapchat),
            "local_export" => Ok(Self::LocalExport),
            _ => Err(format!("Unknown import provider: {}", id)),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::IcloudPhotos => "icloud_photos",
            Self::GooglePhotos => "google_photos",
            Self::Snapchat => "snapchat",
            Self::LocalExport => "local_export",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::IcloudPhotos => "Apple Photos / iCloud",
            Self::GooglePhotos => "Google Photos",
            Self::Snapchat => "Snapchat",
            Self::LocalExport => "Local Export",
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportDiscovery {
    pub provider_id: String,
    pub provider_label: String,
    pub source_path: String,
    pub discovered: usize,
    pub unsupported: usize,
    pub staging_path: Option<String>,
}

#[derive(Debug)]
pub struct ExportMediaCollection {
    pub media_paths: Vec<PathBuf>,
    pub unsupported_count: usize,
    pub staging_dir: Option<PathBuf>,
}

impl ExportMediaCollection {
    pub fn discovery(&self, provider: ImportProvider, source_path: &Path) -> ImportDiscovery {
        ImportDiscovery {
            provider_id: provider.id().to_string(),
            provider_label: provider.label().to_string(),
            source_path: source_path.to_string_lossy().into_owned(),
            discovered: self.media_paths.len(),
            unsupported: self.unsupported_count,
            staging_path: self
                .staging_dir
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
        }
    }
}

pub fn collect_export_media(
    provider: ImportProvider,
    source_path: &Path,
) -> Result<ExportMediaCollection, String> {
    if !source_path.exists() {
        return Err(format!("Import source does not exist: {}", source_path.display()));
    }

    if source_path.is_dir() {
        return collect_from_directory(source_path, None);
    }

    if source_path.is_file() && has_extension(source_path, "zip") {
        return collect_from_zip(provider, source_path);
    }

    Err(format!(
        "Import source must be a folder or .zip archive: {}",
        source_path.display()
    ))
}

pub fn is_supported_media_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_lowercase();
            MEDIA_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

fn collect_from_directory(
    root: &Path,
    staging_dir: Option<PathBuf>,
) -> Result<ExportMediaCollection, String> {
    let mut media_paths = Vec::new();
    let mut unsupported_count = 0;

    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        if should_skip_path(path) {
            continue;
        }

        if is_supported_media_path(path) {
            media_paths.push(path.to_path_buf());
        } else if !is_ignorable_export_file(path) {
            unsupported_count += 1;
        }
    }

    Ok(ExportMediaCollection {
        media_paths,
        unsupported_count,
        staging_dir,
    })
}

fn collect_from_zip(
    provider: ImportProvider,
    source_path: &Path,
) -> Result<ExportMediaCollection, String> {
    let archive_file = File::open(source_path)
        .map_err(|e| format!("Failed to open ZIP archive {}: {}", source_path.display(), e))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|e| format!("Failed to read ZIP archive {}: {}", source_path.display(), e))?;

    let staging_dir = staging_root(provider)?;
    let mut unsupported_count = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

        if entry.is_dir() {
            continue;
        }

        let enclosed_name = match entry.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        if should_skip_path(&enclosed_name) {
            continue;
        }

        if !is_supported_media_path(&enclosed_name) {
            if !is_ignorable_export_file(&enclosed_name) {
                unsupported_count += 1;
            }
            continue;
        }

        let output_path = staging_dir.join(&enclosed_name);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create ZIP staging folder {}: {}", parent.display(), e)
            })?;
        }

        let mut output = File::create(&output_path).map_err(|e| {
            format!("Failed to create ZIP staging file {}: {}", output_path.display(), e)
        })?;
        io::copy(&mut entry, &mut output).map_err(|e| {
            format!("Failed to extract ZIP entry {}: {}", enclosed_name.display(), e)
        })?;
    }

    collect_from_directory(&staging_dir.clone(), Some(staging_dir))
        .map(|mut collection| {
            collection.unsupported_count += unsupported_count;
            collection
        })
}

fn staging_root(provider: ImportProvider) -> Result<PathBuf, String> {
    let mut root = dirs::data_local_dir().ok_or("Failed to get local data directory")?;
    root.push("terra");
    root.push("import-staging");
    root.push(provider.id());
    root.push(chrono::Utc::now().timestamp_millis().to_string());
    fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create import staging folder {}: {}", root.display(), e))?;
    Ok(root)
}

fn should_skip_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name == "__MACOSX" || name.starts_with("._") || name == ".DS_Store"
    })
}

fn is_ignorable_export_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_lowercase();
            IGNORED_EXPORT_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_media_extensions_case_insensitively() {
        assert!(is_supported_media_path(Path::new("IMG_0001.JPG")));
        assert!(is_supported_media_path(Path::new("clip.MOV")));
        assert!(is_supported_media_path(Path::new("photo.heic")));
    }

    #[test]
    fn rejects_non_media_extensions() {
        assert!(!is_supported_media_path(Path::new("metadata.json")));
        assert!(!is_supported_media_path(Path::new("index.html")));
        assert!(!is_supported_media_path(Path::new("archive.zip")));
    }

    #[test]
    fn maps_provider_ids_to_source_types() {
        let provider = ImportProvider::from_id("google_photos").unwrap();
        assert_eq!(provider.id(), "google_photos");
        assert_eq!(provider.label(), "Google Photos");
        assert!(ImportProvider::from_id("unknown").is_err());
    }
}
