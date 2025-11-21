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
            created_at INTEGER NOT NULL,
            is_favorite INTEGER DEFAULT 0
        )",
        [],
    )?;

    // Attempt to add is_favorite column if it doesn't exist (for existing DBs)
    // We ignore the error if the column already exists
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN is_favorite INTEGER DEFAULT 0", []);

    // Create albums table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cover_photo_path TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create album_photos table (junction table)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS album_photos (
            album_id INTEGER NOT NULL,
            photo_path TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (album_id, photo_path),
            FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
            FOREIGN KEY (photo_path) REFERENCES photos(path) ON DELETE CASCADE
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

pub fn insert_photo(conn: &Connection, photo: &PhotoMetadata, source_type: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO photos (path, name, date_taken, width, height, source_type, created_at, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            photo.path,
            photo.name,
            photo.date_taken,
            photo.width,
            photo.height,
            source_type,
            chrono::Utc::now().timestamp(),
            if photo.is_favorite { 1 } else { 0 }
        ],
    )?;
    Ok(())
}

/// Get all photos from the database, sorted by date_taken descending
pub fn get_all_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite FROM photos ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| {
        Ok(PhotoMetadata {
            path: row.get(0)?,
            name: row.get(1)?,
            date_taken: row.get(2)?,
            width: row.get(3)?,
            height: row.get(4)?,
            is_favorite: row.get::<_, i32>(5)? != 0,
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

/// Set photo favorite status
pub fn set_photo_favorite(conn: &Connection, path: &str, is_favorite: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE photos SET is_favorite = ?1 WHERE path = ?2",
        params![if is_favorite { 1 } else { 0 }, path],
    )?;
    Ok(())
}

/// Create a new album
pub fn create_album(conn: &Connection, name: &str) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO albums (name, created_at) VALUES (?1, ?2)",
        params![name, chrono::Utc::now().timestamp()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Delete an album
pub fn delete_album(conn: &Connection, id: i64) -> SqlResult<()> {
    conn.execute("DELETE FROM albums WHERE id = ?1", params![id])?;
    Ok(())
}

/// Add a photo to an album
pub fn add_photo_to_album(conn: &Connection, album_id: i64, photo_path: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO album_photos (album_id, photo_path, added_at) VALUES (?1, ?2, ?3)",
        params![album_id, photo_path, chrono::Utc::now().timestamp()],
    )?;
    Ok(())
}

/// Remove a photo from an album
pub fn remove_photo_from_album(conn: &Connection, album_id: i64, photo_path: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM album_photos WHERE album_id = ?1 AND photo_path = ?2",
        params![album_id, photo_path],
    )?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct Album {
    pub id: i64,
    pub name: String,
    pub cover_photo_path: Option<String>,
    pub count: i64,
}

/// Get all albums with photo counts
pub fn get_albums(conn: &Connection) -> SqlResult<Vec<Album>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, a.cover_photo_path, COUNT(ap.photo_path) as count
         FROM albums a
         LEFT JOIN album_photos ap ON a.id = ap.album_id
         GROUP BY a.id
         ORDER BY a.created_at DESC"
    )?;

    let albums = stmt.query_map([], |row| {
        Ok(Album {
            id: row.get(0)?,
            name: row.get(1)?,
            cover_photo_path: row.get(2)?,
            count: row.get(3)?,
        })
    })?;

    let mut result = Vec::new();
    for album in albums {
        result.push(album?);
    }
    Ok(result)
}

/// Get all photos in an album
pub fn get_album_photos(conn: &Connection, album_id: i64) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite
         FROM photos p
         JOIN album_photos ap ON p.path = ap.photo_path
         WHERE ap.album_id = ?1
         ORDER BY p.date_taken DESC"
    )?;

    let photos = stmt.query_map(params![album_id], |row| {
        Ok(PhotoMetadata {
            path: row.get(0)?,
            name: row.get(1)?,
            date_taken: row.get(2)?,
            width: row.get(3)?,
            height: row.get(4)?,
            is_favorite: row.get::<_, i32>(5)? != 0,
        })
    })?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

/// Set album cover photo
pub fn set_album_cover(conn: &Connection, album_id: i64, photo_path: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE albums SET cover_photo_path = ?1 WHERE id = ?2",
        params![photo_path, album_id],
    )?;
    Ok(())
}
