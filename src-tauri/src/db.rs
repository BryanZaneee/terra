use rusqlite::{Connection, Result as SqlResult, params};
use std::path::PathBuf;
use dirs;
use crate::PhotoMetadata;

/// Get the path to the Terra database file
pub fn get_db_path() -> PathBuf {
    let mut path = dirs::data_local_dir().expect("Failed to get local data directory");
    path.push("terra");
    std::fs::create_dir_all(&path).expect("Failed to create Terra data directory");
    path.push("photos.db");
    path
}

/// Get the path to the managed Terra library directory
pub fn get_library_path() -> PathBuf {
    let mut path = dirs::picture_dir().expect("Failed to get Pictures directory");
    path.push("Terra");
    std::fs::create_dir_all(&path).expect("Failed to create Terra library directory");
    path
}

/// Initialize the database and create tables if they don't exist
pub fn init_database() -> SqlResult<Connection> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            date_taken INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create index on date_taken for faster sorting
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_date_taken ON photos(date_taken DESC)",
        [],
    )?;

    Ok(conn)
}

/// Insert a photo into the database (or update if it already exists)
pub fn insert_photo(conn: &Connection, photo: &PhotoMetadata, source_type: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO photos (path, name, date_taken, width, height, source_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            photo.path,
            photo.name,
            photo.date_taken,
            photo.width,
            photo.height,
            source_type,
            chrono::Utc::now().timestamp()
        ],
    )?;
    Ok(())
}

/// Get all photos from the database, sorted by date_taken descending
pub fn get_all_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height FROM photos ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| {
        Ok(PhotoMetadata {
            path: row.get(0)?,
            name: row.get(1)?,
            date_taken: row.get(2)?,
            width: row.get(3)?,
            height: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }

    Ok(result)
}

/// Check if a photo already exists in the database
pub fn photo_exists(conn: &Connection, path: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE path = ?1")?;
    let count: i64 = stmt.query_row(params![path], |row| row.get(0))?;
    Ok(count > 0)
}

/// Delete a photo from the database
pub fn delete_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
    Ok(())
}

/// Get photo count by year
pub fn get_photo_count_by_year(conn: &Connection) -> SqlResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y', date_taken, 'unixepoch') as year, COUNT(*) as count
         FROM photos
         GROUP BY year
         ORDER BY year DESC"
    )?;

    let counts = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut result = Vec::new();
    for count in counts {
        result.push(count?);
    }

    Ok(result)
}
