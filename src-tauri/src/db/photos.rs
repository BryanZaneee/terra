use rusqlite::{Connection, Result as SqlResult, params};
use crate::PhotoMetadata;

pub fn insert_photo(conn: &Connection, photo: &PhotoMetadata, source_type: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO photos (path, name, date_taken, width, height, source_type, created_at, is_favorite, content_hash, latitude, longitude, location_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            photo.path,
            photo.name,
            photo.date_taken,
            photo.width,
            photo.height,
            source_type,
            chrono::Utc::now().timestamp(),
            if photo.is_favorite { 1 } else { 0 },
            photo.content_hash,
            photo.latitude,
            photo.longitude,
            photo.location_name
        ],
    )?;
    Ok(())
}

/// Delete a photo from the database
pub fn delete_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
    Ok(())
}

/// Set photo favorite status
pub fn set_photo_favorite(conn: &Connection, path: &str, is_favorite: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET is_favorite = ?1 WHERE path = ?2",
        params![if is_favorite { 1 } else { 0 }, path],
    )?;
    Ok(())
}

/// Get all unique locations with photo counts
pub fn get_locations(conn: &Connection) -> SqlResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT location_name, COUNT(*) as count
         FROM photos
         WHERE location_name IS NOT NULL
         GROUP BY location_name
         ORDER BY count DESC"
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

/// Check if a photo with the given hash exists
pub fn hash_exists(conn: &Connection, hash: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE content_hash = ?1")?;
    let count: i64 = stmt.query_row(params![hash], |row| row.get(0))?;
    Ok(count > 0)
}
