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

/// Get the path to the managed Terra library directory.
/// Checks the settings table for a custom path first, falls back to ~/Pictures/Terra.
pub fn get_library_path() -> PathBuf {
    // Try to read custom path from settings
    if let Ok(conn) = Connection::open(get_db_path()) {
        if let Some(custom_path) = get_setting(&conn, "library_path") {
            let path = PathBuf::from(&custom_path);
            if std::fs::create_dir_all(&path).is_ok() {
                return path;
            }
        }
    }

    let mut path = dirs::picture_dir().expect("Failed to get Pictures directory");
    path.push("Terra");
    std::fs::create_dir_all(&path).expect("Failed to create Terra library directory");
    path
}

/// Initialize schema on an existing connection.
/// Used by both init_database() and tests (with in-memory DBs).
pub fn init_schema(conn: &Connection) -> SqlResult<()> {
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
            is_favorite INTEGER DEFAULT 0,
            content_hash TEXT,
            latitude REAL,
            longitude REAL,
            location_name TEXT
        )",
        [],
    )?;

    // Attempt to add columns if they don't exist (for existing DBs)
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN is_favorite INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN content_hash TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN latitude REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN longitude REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN location_name TEXT", []);

    // New columns for duplicate/screenshot detection
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN dhash_64 INTEGER", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN is_screenshot INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN archived_at INTEGER", []);

    // New columns for TerraForm and Smart Collections
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN reviewed_at INTEGER", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN file_size INTEGER", []);

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

    // Create index on content_hash for duplicate detection
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_content_hash ON photos(content_hash)",
        [],
    )?;

    // Create index on location_name for search
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_location_name ON photos(location_name)",
        [],
    )?;

    // Create index on dhash for fast duplicate lookup
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dhash ON photos(dhash_64)",
        [],
    )?;

    // Create index on archived_at for archive management
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_archived ON photos(archived_at)",
        [],
    )?;

    // Create index on reviewed_at for TerraForm
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_reviewed ON photos(reviewed_at)",
        [],
    )?;

    // Create index on file_size for Smart Collections
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_size ON photos(file_size)",
        [],
    )?;

    // Create tags table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Create photo_tags junction table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS photo_tags (
            tag_id INTEGER NOT NULL,
            photo_path TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (tag_id, photo_path),
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            FOREIGN KEY (photo_path) REFERENCES photos(path) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create indexes for photo_tags
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_photo_tags_photo ON photo_tags(photo_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id)",
        [],
    )?;

    // Create settings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

/// Initialize the database and create tables if they don't exist
pub fn init_database() -> SqlResult<Connection> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    init_schema(&conn)?;
    Ok(conn)
}

// ============================================================================
// Settings Functions
// ============================================================================

/// Get a setting value by key
pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok()
}

/// Set a setting value
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

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

/// Map a row (with the standard 10-column SELECT) into a PhotoMetadata.
/// Expected column order: path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
fn photo_from_row(row: &rusqlite::Row) -> rusqlite::Result<PhotoMetadata> {
    Ok(PhotoMetadata {
        path: row.get(0)?,
        name: row.get(1)?,
        date_taken: row.get(2)?,
        width: row.get(3)?,
        height: row.get(4)?,
        is_favorite: row.get::<_, i32>(5)? != 0,
        content_hash: row.get(6)?,
        latitude: row.get(7)?,
        longitude: row.get(8)?,
        location_name: row.get(9)?,
    })
}

/// Get all photos from the database, sorted by date_taken descending
pub fn get_all_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name 
         FROM photos ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| photo_from_row(row))?;

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
        "SELECT p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, p.latitude, p.longitude, p.location_name
         FROM photos p
         JOIN album_photos ap ON p.path = ap.photo_path
         WHERE ap.album_id = ?1
         ORDER BY p.date_taken DESC"
    )?;

    let photos = stmt.query_map(params![album_id], |row| photo_from_row(row))?;

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

/// Get all photos that have duplicates (same content_hash)
pub fn get_duplicates(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
         FROM photos
         WHERE content_hash IN (
             SELECT content_hash FROM photos GROUP BY content_hash HAVING COUNT(*) > 1
         )
         ORDER BY content_hash, date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

/// Search photos by text (name or location)
pub fn search_photos(conn: &Connection, query: &str) -> SqlResult<Vec<PhotoMetadata>> {
    let search_term = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
         FROM photos
         WHERE name LIKE ?1 OR location_name LIKE ?1
         ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map(params![search_term], |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
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

    let locations = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;

    let mut result = Vec::new();
    for loc in locations {
        result.push(loc?);
    }
    Ok(result)
}

/// Check if a photo with the given hash exists
pub fn hash_exists(conn: &Connection, hash: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE content_hash = ?1")?;
    let count: i64 = stmt.query_row(params![hash], |row| row.get(0))?;
    Ok(count > 0)
}

// ============================================================================
// Duplicate Detection and Archive Functions
// ============================================================================

/// Get the path to the archive directory
pub fn get_archive_path() -> std::path::PathBuf {
    let mut path = get_library_path();
    path.push("Archive");
    std::fs::create_dir_all(&path).expect("Failed to create Archive directory");
    path
}

/// Get all photos that need dhash computation (dhash_64 is NULL and not archived)
pub fn get_photos_without_dhash(conn: &Connection) -> SqlResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT path, name FROM photos WHERE dhash_64 IS NULL AND archived_at IS NULL"
    )?;

    let photos = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
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

    let photos = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

/// Get all photos marked as screenshots
pub fn get_screenshots(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
         FROM photos WHERE is_screenshot = 1 AND archived_at IS NULL ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
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
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name, archived_at
         FROM photos WHERE archived_at IS NOT NULL ORDER BY archived_at DESC"
    )?;

    let photos = stmt.query_map([], |row| {
        let photo = photo_from_row(row)?;
        let archived_at: i64 = row.get(10)?;
        Ok((photo, archived_at))
    })?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

/// Get photos archived more than N days ago (for cleanup)
pub fn get_old_archived_photos(conn: &Connection, days: i64) -> SqlResult<Vec<String>> {
    let cutoff = chrono::Utc::now().timestamp() - (days * 24 * 60 * 60);
    let mut stmt = conn.prepare(
        "SELECT path FROM photos WHERE archived_at IS NOT NULL AND archived_at < ?1"
    )?;

    let paths = stmt.query_map(params![cutoff], |row| {
        Ok(row.get(0)?)
    })?;

    let mut result = Vec::new();
    for path in paths {
        result.push(path?);
    }
    Ok(result)
}

/// Permanently delete a photo from database
pub fn permanently_delete_photo(conn: &Connection, path: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM photos WHERE path = ?1", params![path])?;
    Ok(())
}

/// Get total photo count (non-archived)
pub fn get_photo_count(conn: &Connection) -> SqlResult<i64> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}

/// Get count of photos with dhash computed
pub fn get_photos_with_dhash_count(conn: &Connection) -> SqlResult<i64> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM photos WHERE dhash_64 IS NOT NULL AND archived_at IS NULL")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count)
}

// ============================================================================
// TerraForm (Review Mode) Functions
// ============================================================================

/// Get all unreviewed photos (reviewed_at is NULL and not archived)
pub fn get_unreviewed_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
         FROM photos WHERE reviewed_at IS NULL AND archived_at IS NULL ORDER BY date_taken DESC"
    )?;

    let photos = stmt.query_map([], |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
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

// ============================================================================
// Tag Functions
// ============================================================================

#[derive(serde::Serialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

/// Create a new tag
pub fn create_tag(conn: &Connection, name: &str, color: &str) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO tags (name, color, created_at) VALUES (?1, ?2, ?3)",
        params![name, color, chrono::Utc::now().timestamp()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Update a tag
pub fn update_tag(conn: &Connection, id: i64, name: &str, color: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )?;
    Ok(())
}

/// Delete a tag
pub fn delete_tag(conn: &Connection, id: i64) -> SqlResult<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

/// Get all tags with counts
pub fn get_all_tags(conn: &Connection) -> SqlResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, COUNT(pt.photo_path) as count
         FROM tags t
         LEFT JOIN photo_tags pt ON t.id = pt.tag_id
         LEFT JOIN photos p ON pt.photo_path = p.path AND p.archived_at IS NULL
         GROUP BY t.id
         ORDER BY count DESC, t.name ASC"
    )?;

    let tags = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            count: row.get(3)?,
        })
    })?;

    let mut result = Vec::new();
    for tag in tags {
        result.push(tag?);
    }
    Ok(result)
}

/// Get tags for a specific photo
pub fn get_tags_for_photo(conn: &Connection, path: &str) -> SqlResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, 0 as count
         FROM tags t
         JOIN photo_tags pt ON t.id = pt.tag_id
         WHERE pt.photo_path = ?1
         ORDER BY t.name ASC"
    )?;

    let tags = stmt.query_map(params![path], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            count: row.get(3)?,
        })
    })?;

    let mut result = Vec::new();
    for tag in tags {
        result.push(tag?);
    }
    Ok(result)
}

/// Add tags to photos (bulk operation)
pub fn add_tags_to_photos(conn: &Connection, tag_ids: &[i64], photo_paths: &[String]) -> SqlResult<()> {
    let now = chrono::Utc::now().timestamp();
    for tag_id in tag_ids {
        for path in photo_paths {
            conn.execute(
                "INSERT OR IGNORE INTO photo_tags (tag_id, photo_path, added_at) VALUES (?1, ?2, ?3)",
                params![tag_id, path, now],
            )?;
        }
    }
    Ok(())
}

/// Remove a tag from a photo
pub fn remove_tag_from_photo(conn: &Connection, tag_id: i64, photo_path: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM photo_tags WHERE tag_id = ?1 AND photo_path = ?2",
        params![tag_id, photo_path],
    )?;
    Ok(())
}

/// Get photos by tags (with AND/OR logic)
pub fn get_photos_by_tags(conn: &Connection, tag_ids: &[i64], match_all: bool) -> SqlResult<Vec<PhotoMetadata>> {
    if tag_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let placeholder_str = placeholders.join(",");

    let query = if match_all {
        // AND logic: photo must have ALL specified tags
        format!(
            "SELECT p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, p.latitude, p.longitude, p.location_name
             FROM photos p
             JOIN photo_tags pt ON p.path = pt.photo_path
             WHERE pt.tag_id IN ({}) AND p.archived_at IS NULL
             GROUP BY p.path
             HAVING COUNT(DISTINCT pt.tag_id) = ?
             ORDER BY p.date_taken DESC",
            placeholder_str
        )
    } else {
        // OR logic: photo must have ANY of the specified tags
        format!(
            "SELECT DISTINCT p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, p.latitude, p.longitude, p.location_name
             FROM photos p
             JOIN photo_tags pt ON p.path = pt.photo_path
             WHERE pt.tag_id IN ({}) AND p.archived_at IS NULL
             ORDER BY p.date_taken DESC",
            placeholder_str
        )
    };

    let mut stmt = conn.prepare(&query)?;

    // Build params dynamically
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = tag_ids.iter()
        .map(|id| Box::new(*id) as Box<dyn rusqlite::ToSql>)
        .collect();

    if match_all {
        params_vec.push(Box::new(tag_ids.len() as i64));
    }

    let photos = stmt.query_map(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())), |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

/// Search tags by name (for autocomplete)
pub fn search_tags(conn: &Connection, query: &str) -> SqlResult<Vec<Tag>> {
    let search_term = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, COUNT(pt.photo_path) as count
         FROM tags t
         LEFT JOIN photo_tags pt ON t.id = pt.tag_id
         WHERE t.name LIKE ?1
         GROUP BY t.id
         ORDER BY count DESC, t.name ASC
         LIMIT 10"
    )?;

    let tags = stmt.query_map(params![search_term], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            count: row.get(3)?,
        })
    })?;

    let mut result = Vec::new();
    for tag in tags {
        result.push(tag?);
    }
    Ok(result)
}

// ============================================================================
// Smart Collections Functions
// ============================================================================

#[derive(serde::Serialize)]
pub struct SmartCollection {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub count: i64,
    pub category: String,
}

/// Get all smart collections with counts
pub fn get_smart_collections(conn: &Connection) -> SqlResult<Vec<SmartCollection>> {
    let mut collections = Vec::new();

    // Size-based collections
    let large_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE file_size > 5242880 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "size_large".to_string(),
        name: "Large (>5MB)".to_string(),
        icon: "hard-drive".to_string(),
        count: large_count,
        category: "size".to_string(),
    });

    let medium_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE file_size BETWEEN 1048576 AND 5242880 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "size_medium".to_string(),
        name: "Medium (1-5MB)".to_string(),
        icon: "hard-drive".to_string(),
        count: medium_count,
        category: "size".to_string(),
    });

    let small_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE file_size < 1048576 AND file_size > 0 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "size_small".to_string(),
        name: "Small (<1MB)".to_string(),
        icon: "hard-drive".to_string(),
        count: small_count,
        category: "size".to_string(),
    });

    // Dimension-based collections
    let dim_4k: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE (width >= 3840 OR height >= 2160) AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "dim_4k".to_string(),
        name: "4K+".to_string(),
        icon: "monitor".to_string(),
        count: dim_4k,
        category: "dimension".to_string(),
    });

    let dim_hd: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE (width >= 1920 OR height >= 1080) AND width < 3840 AND height < 2160 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "dim_hd".to_string(),
        name: "HD".to_string(),
        icon: "monitor".to_string(),
        count: dim_hd,
        category: "dimension".to_string(),
    });

    let portrait: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE height > width AND width > 0 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "dim_portrait".to_string(),
        name: "Portrait".to_string(),
        icon: "smartphone".to_string(),
        count: portrait,
        category: "dimension".to_string(),
    });

    let landscape: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE width > height AND height > 0 AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "dim_landscape".to_string(),
        name: "Landscape".to_string(),
        icon: "monitor".to_string(),
        count: landscape,
        category: "dimension".to_string(),
    });

    // Time-based collections
    let now = chrono::Utc::now().timestamp();
    let seven_days_ago = now - (7 * 24 * 60 * 60);
    let thirty_days_ago = now - (30 * 24 * 60 * 60);

    let last_7_days: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE date_taken > ?1 AND archived_at IS NULL",
        params![seven_days_ago],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "time_7days".to_string(),
        name: "Last 7 Days".to_string(),
        icon: "calendar".to_string(),
        count: last_7_days,
        category: "time".to_string(),
    });

    let last_30_days: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE date_taken > ?1 AND archived_at IS NULL",
        params![thirty_days_ago],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "time_30days".to_string(),
        name: "Last 30 Days".to_string(),
        icon: "calendar".to_string(),
        count: last_30_days,
        category: "time".to_string(),
    });

    let current_year = chrono::Utc::now().format("%Y").to_string();
    let this_year: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE strftime('%Y', date_taken, 'unixepoch') = ?1 AND archived_at IS NULL",
        params![current_year],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "time_year".to_string(),
        name: "This Year".to_string(),
        icon: "calendar".to_string(),
        count: this_year,
        category: "time".to_string(),
    });

    // Status-based collections
    let unreviewed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE reviewed_at IS NULL AND archived_at IS NULL",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    collections.push(SmartCollection {
        id: "status_unreviewed".to_string(),
        name: "Unreviewed".to_string(),
        icon: "eye-off".to_string(),
        count: unreviewed,
        category: "status".to_string(),
    });

    Ok(collections)
}

/// Get photos for a specific smart collection
pub fn get_smart_collection_photos(conn: &Connection, collection_id: &str) -> SqlResult<Vec<PhotoMetadata>> {
    let now = chrono::Utc::now().timestamp();
    let seven_days_ago = now - (7 * 24 * 60 * 60);
    let thirty_days_ago = now - (30 * 24 * 60 * 60);
    let current_year = chrono::Utc::now().format("%Y").to_string();

    let query = match collection_id {
        "size_large" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE file_size > 5242880 AND archived_at IS NULL ORDER BY file_size DESC",
        "size_medium" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE file_size BETWEEN 1048576 AND 5242880 AND archived_at IS NULL ORDER BY file_size DESC",
        "size_small" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE file_size < 1048576 AND file_size > 0 AND archived_at IS NULL ORDER BY file_size DESC",
        "dim_4k" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE (width >= 3840 OR height >= 2160) AND archived_at IS NULL ORDER BY date_taken DESC",
        "dim_hd" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE (width >= 1920 OR height >= 1080) AND width < 3840 AND height < 2160 AND archived_at IS NULL ORDER BY date_taken DESC",
        "dim_portrait" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE height > width AND width > 0 AND archived_at IS NULL ORDER BY date_taken DESC",
        "dim_landscape" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE width > height AND height > 0 AND archived_at IS NULL ORDER BY date_taken DESC",
        "status_unreviewed" => "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name FROM photos WHERE reviewed_at IS NULL AND archived_at IS NULL ORDER BY date_taken DESC",
        _ => return Ok(Vec::new()),
    };

    // Handle time-based queries separately due to parameters
    if collection_id == "time_7days" {
        let mut stmt = conn.prepare(
            "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
             FROM photos WHERE date_taken > ?1 AND archived_at IS NULL ORDER BY date_taken DESC"
        )?;
        return query_photos(&mut stmt, params![seven_days_ago]);
    } else if collection_id == "time_30days" {
        let mut stmt = conn.prepare(
            "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
             FROM photos WHERE date_taken > ?1 AND archived_at IS NULL ORDER BY date_taken DESC"
        )?;
        return query_photos(&mut stmt, params![thirty_days_ago]);
    } else if collection_id == "time_year" {
        let mut stmt = conn.prepare(
            "SELECT path, name, date_taken, width, height, is_favorite, content_hash, latitude, longitude, location_name
             FROM photos WHERE strftime('%Y', date_taken, 'unixepoch') = ?1 AND archived_at IS NULL ORDER BY date_taken DESC"
        )?;
        return query_photos(&mut stmt, params![current_year]);
    }

    let mut stmt = conn.prepare(query)?;
    query_photos(&mut stmt, [])
}

fn query_photos<P: rusqlite::Params>(stmt: &mut rusqlite::Statement, params: P) -> SqlResult<Vec<PhotoMetadata>> {
    let photos = stmt.query_map(params, |row| photo_from_row(row))?;

    let mut result = Vec::new();
    for photo in photos {
        result.push(photo?);
    }
    Ok(result)
}

// ============================================================================
// Storage Analytics Functions
// ============================================================================

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
    let mut size_by_month = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', date_taken, 'unixepoch') as month,
                COALESCE(SUM(file_size), 0) as size,
                COUNT(*) as count
         FROM photos
         WHERE archived_at IS NULL AND date_taken > strftime('%s', 'now', '-12 months')
         GROUP BY month
         ORDER BY month DESC"
    )?;
    let months = stmt.query_map([], |row| {
        Ok(MonthSize {
            month: row.get(0)?,
            size: row.get(1)?,
            count: row.get(2)?,
        })
    })?;
    for month in months {
        size_by_month.push(month?);
    }

    // Size by year
    let mut size_by_year = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y', date_taken, 'unixepoch') as year,
                COALESCE(SUM(file_size), 0) as size,
                COUNT(*) as count
         FROM photos
         WHERE archived_at IS NULL
         GROUP BY year
         ORDER BY year DESC"
    )?;
    let years = stmt.query_map([], |row| {
        Ok(YearSize {
            year: row.get(0)?,
            size: row.get(1)?,
            count: row.get(2)?,
        })
    })?;
    for year in years {
        size_by_year.push(year?);
    }

    // Top 10 largest files
    let mut top_largest_files = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT path, name, file_size, date_taken
         FROM photos
         WHERE archived_at IS NULL AND file_size IS NOT NULL
         ORDER BY file_size DESC
         LIMIT 10"
    )?;
    let files = stmt.query_map([], |row| {
        Ok(LargeFile {
            path: row.get(0)?,
            name: row.get(1)?,
            size: row.get(2)?,
            date_taken: row.get(3)?,
        })
    })?;
    for file in files {
        top_largest_files.push(file?);
    }

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

    let paths = stmt.query_map([], |row| {
        Ok(row.get(0)?)
    })?;

    let mut result = Vec::new();
    for path in paths {
        result.push(path?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a PhotoMetadata for testing
    fn test_photo(path: &str, name: &str) -> PhotoMetadata {
        PhotoMetadata {
            path: path.to_string(),
            name: name.to_string(),
            date_taken: 1700000000,
            width: 1920,
            height: 1080,
            is_favorite: false,
            content_hash: Some("abc123".to_string()),
            latitude: None,
            longitude: None,
            location_name: None,
        }
    }

    /// Helper to create an in-memory database with schema initialized
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory database");
        init_schema(&conn).expect("Failed to initialize schema");
        conn
    }

    // ====================================================================
    // Photos tests
    // ====================================================================

    #[test]
    fn test_insert_and_get_all_photos() {
        let conn = setup_db();
        let photo = test_photo("/photos/test.jpg", "test.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let photos = get_all_photos(&conn).unwrap();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].path, "/photos/test.jpg");
        assert_eq!(photos[0].name, "test.jpg");
        assert_eq!(photos[0].date_taken, 1700000000);
    }

    #[test]
    fn test_photo_exists_true_for_inserted() {
        let conn = setup_db();
        let photo = test_photo("/photos/exists.jpg", "exists.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        assert!(photo_exists(&conn, "/photos/exists.jpg").unwrap());
    }

    #[test]
    fn test_photo_exists_false_for_missing() {
        let conn = setup_db();
        assert!(!photo_exists(&conn, "/photos/missing.jpg").unwrap());
    }

    #[test]
    fn test_delete_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/delete_me.jpg", "delete_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();
        assert!(photo_exists(&conn, "/photos/delete_me.jpg").unwrap());

        delete_photo(&conn, "/photos/delete_me.jpg").unwrap();
        assert!(!photo_exists(&conn, "/photos/delete_me.jpg").unwrap());
    }

    #[test]
    fn test_search_photos_by_name() {
        let conn = setup_db();
        let photo = test_photo("/photos/sunset_beach.jpg", "sunset_beach.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let results = search_photos(&conn, "sunset").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "sunset_beach.jpg");
    }

    #[test]
    fn test_search_photos_by_location() {
        let conn = setup_db();
        let mut photo = test_photo("/photos/trip.jpg", "trip.jpg");
        photo.location_name = Some("San Francisco, California".to_string());
        insert_photo(&conn, &photo, "upload").unwrap();

        let results = search_photos(&conn, "San Francisco").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].location_name.as_deref(), Some("San Francisco, California"));
    }

    #[test]
    fn test_get_photo_count() {
        let conn = setup_db();
        assert_eq!(get_photo_count(&conn).unwrap(), 0);

        insert_photo(&conn, &test_photo("/photos/a.jpg", "a.jpg"), "upload").unwrap();
        insert_photo(&conn, &test_photo("/photos/b.jpg", "b.jpg"), "upload").unwrap();
        assert_eq!(get_photo_count(&conn).unwrap(), 2);
    }

    // ====================================================================
    // Favorites tests
    // ====================================================================

    #[test]
    fn test_set_photo_favorite_on() {
        let conn = setup_db();
        let photo = test_photo("/photos/fav.jpg", "fav.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        set_photo_favorite(&conn, "/photos/fav.jpg", true).unwrap();
        let photos = get_all_photos(&conn).unwrap();
        assert!(photos[0].is_favorite);
    }

    #[test]
    fn test_set_photo_favorite_toggle_off() {
        let conn = setup_db();
        let photo = test_photo("/photos/fav2.jpg", "fav2.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        set_photo_favorite(&conn, "/photos/fav2.jpg", true).unwrap();
        set_photo_favorite(&conn, "/photos/fav2.jpg", false).unwrap();
        let photos = get_all_photos(&conn).unwrap();
        assert!(!photos[0].is_favorite);
    }

    // ====================================================================
    // Albums tests
    // ====================================================================

    #[test]
    fn test_create_album_and_get_albums() {
        let conn = setup_db();
        let album_id = create_album(&conn, "Vacation").unwrap();
        assert!(album_id > 0);

        let albums = get_albums(&conn).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].name, "Vacation");
        assert_eq!(albums[0].count, 0);
    }

    #[test]
    fn test_add_photo_to_album_and_get_album_photos() {
        let conn = setup_db();
        let photo = test_photo("/photos/album_pic.jpg", "album_pic.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let album_id = create_album(&conn, "Trip").unwrap();
        add_photo_to_album(&conn, album_id, "/photos/album_pic.jpg").unwrap();

        let photos = get_album_photos(&conn, album_id).unwrap();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].path, "/photos/album_pic.jpg");
    }

    #[test]
    fn test_remove_photo_from_album() {
        let conn = setup_db();
        let photo = test_photo("/photos/remove_me.jpg", "remove_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let album_id = create_album(&conn, "Temp").unwrap();
        add_photo_to_album(&conn, album_id, "/photos/remove_me.jpg").unwrap();
        assert_eq!(get_album_photos(&conn, album_id).unwrap().len(), 1);

        remove_photo_from_album(&conn, album_id, "/photos/remove_me.jpg").unwrap();
        assert_eq!(get_album_photos(&conn, album_id).unwrap().len(), 0);
    }

    #[test]
    fn test_delete_album_cascade() {
        let conn = setup_db();
        let photo = test_photo("/photos/cascade.jpg", "cascade.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let album_id = create_album(&conn, "ToDelete").unwrap();
        add_photo_to_album(&conn, album_id, "/photos/cascade.jpg").unwrap();

        delete_album(&conn, album_id).unwrap();
        let albums = get_albums(&conn).unwrap();
        assert_eq!(albums.len(), 0);
    }

    #[test]
    fn test_set_album_cover() {
        let conn = setup_db();
        let photo = test_photo("/photos/cover.jpg", "cover.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let album_id = create_album(&conn, "WithCover").unwrap();
        set_album_cover(&conn, album_id, "/photos/cover.jpg").unwrap();

        let albums = get_albums(&conn).unwrap();
        assert_eq!(albums[0].cover_photo_path.as_deref(), Some("/photos/cover.jpg"));
    }

    // ====================================================================
    // Tags tests
    // ====================================================================

    #[test]
    fn test_create_tag_and_get_all_tags() {
        let conn = setup_db();
        let tag_id = create_tag(&conn, "nature", "#00ff00").unwrap();
        assert!(tag_id > 0);

        let tags = get_all_tags(&conn).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "nature");
        assert_eq!(tags[0].color, "#00ff00");
        assert_eq!(tags[0].count, 0);
    }

    #[test]
    fn test_update_tag() {
        let conn = setup_db();
        let tag_id = create_tag(&conn, "old_name", "#000000").unwrap();

        update_tag(&conn, tag_id, "new_name", "#ff0000").unwrap();

        let tags = get_all_tags(&conn).unwrap();
        assert_eq!(tags[0].name, "new_name");
        assert_eq!(tags[0].color, "#ff0000");
    }

    #[test]
    fn test_delete_tag() {
        let conn = setup_db();
        let tag_id = create_tag(&conn, "temporary", "#123456").unwrap();
        assert_eq!(get_all_tags(&conn).unwrap().len(), 1);

        delete_tag(&conn, tag_id).unwrap();
        assert_eq!(get_all_tags(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_add_tags_to_photos_and_get_tags_for_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/tagged.jpg", "tagged.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let tag_id = create_tag(&conn, "landscape", "#0000ff").unwrap();
        add_tags_to_photos(&conn, &[tag_id], &["/photos/tagged.jpg".to_string()]).unwrap();

        let tags = get_tags_for_photo(&conn, "/photos/tagged.jpg").unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "landscape");
    }

    #[test]
    fn test_remove_tag_from_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/untag.jpg", "untag.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let tag_id = create_tag(&conn, "removable", "#aabbcc").unwrap();
        add_tags_to_photos(&conn, &[tag_id], &["/photos/untag.jpg".to_string()]).unwrap();
        assert_eq!(get_tags_for_photo(&conn, "/photos/untag.jpg").unwrap().len(), 1);

        remove_tag_from_photo(&conn, tag_id, "/photos/untag.jpg").unwrap();
        assert_eq!(get_tags_for_photo(&conn, "/photos/untag.jpg").unwrap().len(), 0);
    }

    // ====================================================================
    // Archive tests
    // ====================================================================

    #[test]
    fn test_archive_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/archive_me.jpg", "archive_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        archive_photo(&conn, "/photos/archive_me.jpg").unwrap();

        let archived = get_archived_photos(&conn).unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].0.path, "/photos/archive_me.jpg");
    }

    #[test]
    fn test_restore_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/restore_me.jpg", "restore_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        archive_photo(&conn, "/photos/restore_me.jpg").unwrap();
        assert_eq!(get_archived_photos(&conn).unwrap().len(), 1);

        restore_photo(&conn, "/photos/restore_me.jpg").unwrap();
        assert_eq!(get_archived_photos(&conn).unwrap().len(), 0);
    }

    // ====================================================================
    // TerraForm Review tests
    // ====================================================================

    #[test]
    fn test_mark_photo_reviewed_drops_unreviewed_count() {
        let conn = setup_db();
        let photo = test_photo("/photos/review.jpg", "review.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let initial_count = get_unreviewed_count(&conn).unwrap();
        assert_eq!(initial_count, 1);

        mark_photo_reviewed(&conn, "/photos/review.jpg").unwrap();
        let after_count = get_unreviewed_count(&conn).unwrap();
        assert_eq!(after_count, 0);
    }

    #[test]
    fn test_unmark_photo_reviewed_restores_count() {
        let conn = setup_db();
        let photo = test_photo("/photos/unreview.jpg", "unreview.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        mark_photo_reviewed(&conn, "/photos/unreview.jpg").unwrap();
        assert_eq!(get_unreviewed_count(&conn).unwrap(), 0);

        unmark_photo_reviewed(&conn, "/photos/unreview.jpg").unwrap();
        assert_eq!(get_unreviewed_count(&conn).unwrap(), 1);
    }

    // ====================================================================
    // Settings tests
    // ====================================================================

    #[test]
    fn test_get_setting_returns_none_for_missing_key() {
        let conn = setup_db();
        assert!(get_setting(&conn, "nonexistent_key").is_none());
    }

    #[test]
    fn test_set_and_get_setting_round_trip() {
        let conn = setup_db();
        set_setting(&conn, "theme", "dark").unwrap();

        let value = get_setting(&conn, "theme");
        assert_eq!(value.as_deref(), Some("dark"));
    }
}
