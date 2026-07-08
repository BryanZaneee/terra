use rusqlite::{Connection, Result as SqlResult, params};

#[derive(serde::Serialize)]
pub struct StorageAnalytics {
    pub total_size_bytes: i64,
    pub total_photos: i64,
    pub total_videos: i64,
    pub total_screenshots: i64,
    pub photos_size: i64,
    pub videos_size: i64,
    pub screenshots_size: i64,
    pub duplicate_space_bytes: i64,
    pub size_by_month: Vec<MonthSize>,
    pub size_by_year: Vec<YearSize>,
    pub top_largest_files: Vec<LargeFile>,
}

#[derive(serde::Serialize)]
pub struct MonthSize {
    pub month: String,
    pub size: i64,
    pub count: i64,
}

#[derive(serde::Serialize)]
pub struct YearSize {
    pub year: String,
    pub size: i64,
    pub count: i64,
}

#[derive(serde::Serialize)]
pub struct LargeFile {
    pub path: String,
    pub name: String,
    pub size: i64,
    pub date_taken: i64,
}

/// Get comprehensive storage analytics
pub fn get_storage_analytics(conn: &Connection) -> SqlResult<StorageAnalytics> {
    // Total size
    let total_size_bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Total counts
    let total_photos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND (
            LOWER(name) LIKE '%.jpg' OR LOWER(name) LIKE '%.jpeg' OR LOWER(name) LIKE '%.png' OR
            LOWER(name) LIKE '%.heic' OR LOWER(name) LIKE '%.webp' OR LOWER(name) LIKE '%.gif' OR LOWER(name) LIKE '%.bmp'
        )",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let total_videos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND (
            LOWER(name) LIKE '%.mp4' OR LOWER(name) LIKE '%.mov' OR LOWER(name) LIKE '%.avi' OR
            LOWER(name) LIKE '%.webm' OR LOWER(name) LIKE '%.mkv'
        )",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let total_screenshots: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE is_screenshot = 1 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Size by media type
    let photos_size: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE archived_at IS NULL AND (
            LOWER(name) LIKE '%.jpg' OR LOWER(name) LIKE '%.jpeg' OR LOWER(name) LIKE '%.png' OR
            LOWER(name) LIKE '%.heic' OR LOWER(name) LIKE '%.webp' OR LOWER(name) LIKE '%.gif' OR LOWER(name) LIKE '%.bmp'
        )",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let videos_size: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE archived_at IS NULL AND (
            LOWER(name) LIKE '%.mp4' OR LOWER(name) LIKE '%.mov' OR LOWER(name) LIKE '%.avi' OR
            LOWER(name) LIKE '%.webm' OR LOWER(name) LIKE '%.mkv'
        )",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let screenshots_size: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE is_screenshot = 1 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Duplicate space (approximate: sum of all duplicate files minus one per group)
    let duplicate_space_bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) - (SELECT COUNT(DISTINCT content_hash) * AVG(file_size) FROM photos WHERE content_hash IS NOT NULL AND archived_at IS NULL)
         FROM photos
         WHERE content_hash IN (SELECT content_hash FROM photos WHERE archived_at IS NULL GROUP BY content_hash HAVING COUNT(*) > 1)
         AND archived_at IS NULL",
        [],
        |row| row.get::<_, f64>(0).map(|v| v as i64),
    ).unwrap_or(0);

    // Size by month (last 12 months)
    let size_by_month: Vec<MonthSize> = conn.prepare(
        "SELECT strftime('%Y-%m', date_taken, 'unixepoch') as month,
                COALESCE(SUM(file_size), 0) as size,
                COUNT(*) as count
         FROM photos
         WHERE archived_at IS NULL AND date_taken > strftime('%s', 'now', '-12 months')
         GROUP BY month
         ORDER BY month DESC"
    )?.query_map([], |row| Ok(MonthSize {
        month: row.get(0)?,
        size: row.get(1)?,
        count: row.get(2)?,
    }))?.collect::<SqlResult<_>>()?;

    // Size by year
    let size_by_year: Vec<YearSize> = conn.prepare(
        "SELECT strftime('%Y', date_taken, 'unixepoch') as year,
                COALESCE(SUM(file_size), 0) as size,
                COUNT(*) as count
         FROM photos
         WHERE archived_at IS NULL
         GROUP BY year
         ORDER BY year DESC"
    )?.query_map([], |row| Ok(YearSize {
        year: row.get(0)?,
        size: row.get(1)?,
        count: row.get(2)?,
    }))?.collect::<SqlResult<_>>()?;

    // Top 10 largest files
    let top_largest_files: Vec<LargeFile> = conn.prepare(
        "SELECT path, name, file_size, date_taken
         FROM photos
         WHERE archived_at IS NULL AND file_size IS NOT NULL
         ORDER BY file_size DESC
         LIMIT 10"
    )?.query_map([], |row| Ok(LargeFile {
        path: row.get(0)?,
        name: row.get(1)?,
        size: row.get(2)?,
        date_taken: row.get(3)?,
    }))?.collect::<SqlResult<_>>()?;

    Ok(StorageAnalytics {
        total_size_bytes,
        total_photos,
        total_videos,
        total_screenshots,
        photos_size,
        videos_size,
        screenshots_size,
        duplicate_space_bytes,
        size_by_month,
        size_by_year,
        top_largest_files,
    })
}

// ============================================================================
// Enriched Metadata Functions
// ============================================================================

/// Write enriched camera/lens/video metadata for a single photo path.
/// Only the enrichment columns are updated; all other columns are untouched.
pub fn update_enriched_metadata(conn: &Connection, path: &str, meta: &crate::metadata_enrich::EnrichedMetadata) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET \
         camera_make = ?1, camera_model = ?2, lens_model = ?3, \
         iso = ?4, aperture = ?5, shutter_us = ?6, focal_length_mm = ?7, \
         orientation = ?8, duration_ms = ?9, codec = ?10 \
         WHERE path = ?11",
        params![
            meta.camera_make,
            meta.camera_model,
            meta.lens_model,
            meta.iso,
            meta.aperture,
            meta.shutter_us,
            meta.focal_length_mm,
            meta.orientation,
            meta.duration_ms,
            meta.codec,
            path,
        ],
    )?;
    Ok(())
}

/// Get paths of photos that have not yet been enriched (camera_make IS NULL).
pub fn get_photos_without_enrichment(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM photos WHERE camera_make IS NULL AND archived_at IS NULL"
    )?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}

/// Get (path, content_hash) for every photo whose thumbnail is missing.
/// Skips archived photos and photos without a content hash (rare; can't be addressed).
pub fn get_photos_without_thumbnails(conn: &Connection) -> SqlResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT path, content_hash FROM photos \
         WHERE thumb_status IS NULL AND content_hash IS NOT NULL AND archived_at IS NULL"
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

/// Set the thumb_status for one photo. Caller passes 'ready', 'failed', or 'unsupported'.
pub fn set_thumb_status(conn: &Connection, path: &str, status: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET thumb_status = ?1 WHERE path = ?2",
        params![status, path],
    )?;
    Ok(())
}

/// Update file size for a photo
pub fn update_photo_file_size(conn: &Connection, path: &str, size: i64) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET file_size = ?1 WHERE path = ?2",
        params![size, path],
    )?;
    Ok(())
}

/// Get photos without file_size populated
pub fn get_photos_without_file_size(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM photos WHERE file_size IS NULL AND archived_at IS NULL"
    )?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}
