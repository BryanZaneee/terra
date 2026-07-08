use rusqlite::{Connection, Result as SqlResult, params};
use crate::PhotoMetadata;
use super::row::{photo_from_row, PHOTO_COLUMNS};

/// Get all photos that need dhash computation
pub fn get_photos_without_dhash(conn: &Connection) -> SqlResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT path, name FROM photos WHERE dhash_64 IS NULL AND archived_at IS NULL"
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

/// Update the dhash for a photo
pub fn update_photo_dhash(conn: &Connection, path: &str, dhash: i64) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET dhash_64 = ?1 WHERE path = ?2",
        params![dhash, path],
    )?;
    Ok(())
}

/// Update the is_screenshot flag for a photo
pub fn update_photo_screenshot_flag(conn: &Connection, path: &str, is_screenshot: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET is_screenshot = ?1 WHERE path = ?2",
        params![if is_screenshot { 1 } else { 0 }, path],
    )?;
    Ok(())
}

/// Get all non-archived photos with their dhash values for duplicate detection
pub fn get_all_photos_with_dhash(conn: &Connection) -> SqlResult<Vec<(String, Option<i64>, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT path, dhash_64, content_hash FROM photos WHERE archived_at IS NULL ORDER BY date_taken DESC"
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    rows.collect()
}

/// Single-query duplicate scan input: full metadata + perceptual hash.
pub fn get_active_photos_for_duplicate_scan(
    conn: &Connection,
) -> SqlResult<Vec<(PhotoMetadata, Option<i64>)>> {
    let query = format!(
        "SELECT {}, dhash_64 FROM photos WHERE archived_at IS NULL ORDER BY date_taken DESC",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], |row| {
        Ok((photo_from_row(row)?, row.get::<_, Option<i64>>(21)?))
    })?;
    rows.collect()
}

pub fn count_active_photos(conn: &Connection) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )
}

pub fn get_active_photos_batch(
    conn: &Connection,
    offset: i64,
    limit: i64,
) -> SqlResult<Vec<PhotoMetadata>> {
    let query = format!(
        "SELECT {} FROM photos WHERE archived_at IS NULL ORDER BY date_taken DESC LIMIT ? OFFSET ?",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map(params![limit, offset], photo_from_row)?;
    rows.collect()
}

/// Get all photos marked as screenshots
pub fn get_screenshots(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let query = format!(
        "SELECT {} FROM photos WHERE is_screenshot = 1 AND archived_at IS NULL ORDER BY date_taken DESC",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], photo_from_row)?;
    rows.collect()
}
