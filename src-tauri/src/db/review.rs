use rusqlite::{Connection, Result as SqlResult, params};
use crate::PhotoMetadata;
use super::row::{photo_from_row, PHOTO_COLUMNS};

/// Get all unreviewed photos (reviewed_at is NULL and not archived)
pub fn get_unreviewed_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let query = format!(
        "SELECT {} FROM photos WHERE reviewed_at IS NULL AND archived_at IS NULL ORDER BY date_taken DESC",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], photo_from_row)?;
    rows.collect()
}

/// Mark a photo as reviewed
pub fn mark_photo_reviewed(conn: &Connection, path: &str) -> SqlResult<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE photos SET reviewed_at = ?1 WHERE path = ?2",
        params![now, path],
    )?;
    Ok(())
}

/// Get count of unreviewed photos
pub fn get_unreviewed_count(conn: &Connection) -> SqlResult<i64> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE reviewed_at IS NULL AND archived_at IS NULL")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}

/// Unmark a photo as reviewed (for undo)
pub fn unmark_photo_reviewed(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET reviewed_at = NULL WHERE path = ?1",
        params![path],
    )?;
    Ok(())
}
