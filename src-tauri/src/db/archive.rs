use rusqlite::{Connection, Result as SqlResult, params};
use crate::PhotoMetadata;
use super::row::{photo_from_row, PHOTO_COLUMNS};
use super::schema::get_library_path;

/// Get the path to the archive directory
pub fn get_archive_path() -> std::path::PathBuf {
    let mut path = get_library_path();
    path.push("Archive");
    std::fs::create_dir_all(&path).expect("Failed to create Archive directory");
    path
}
/// Archive a photo (set archived_at timestamp)
pub fn archive_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE photos SET archived_at = ?1 WHERE path = ?2",
        params![now, path],
    )?;
    Ok(())
}

/// Restore a photo from archive (clear archived_at)
pub fn restore_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET archived_at = NULL WHERE path = ?1",
        params![path],
    )?;
    Ok(())
}

/// Get all archived photos
pub fn get_archived_photos(conn: &Connection) -> SqlResult<Vec<(PhotoMetadata, i64)>> {
    let query = format!(
        "SELECT {}, archived_at FROM photos WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    // archived_at is at index 21 (after the 21 PHOTO_COLUMNS fields)
    let rows = stmt.query_map([], |row| Ok((photo_from_row(row)?, row.get::<_, i64>(21)?)))?;
    rows.collect()
}

/// Get photos archived more than N days ago (for cleanup)
pub fn get_old_archived_photos(conn: &Connection, days: i64) -> SqlResult<Vec<String>> {
    let cutoff = chrono::Utc::now().timestamp() - (days * 24 * 60 * 60);
    let mut stmt = conn.prepare(
        "SELECT path FROM photos WHERE archived_at IS NOT NULL AND archived_at < ?1"
    )?;
    let rows = stmt.query_map(params![cutoff], |row| row.get(0))?;
    rows.collect()
}

/// Permanently delete a photo from database
pub fn permanently_delete_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
    Ok(())
}
