use rusqlite::{Connection, Result as SqlResult, params};
use std::path::PathBuf;
use dirs;
use crate::{Cursor, PageResult, PhotoMetadata, ViewCounts, ViewFilter};

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

/// Bump when adding new ALTER TABLE migrations below.
/// Cold start skips them entirely when user_version already matches.
const SCHEMA_VERSION: i32 = 1;

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

    // Skip the ALTER TABLE backfill on every cold start once we've already
    // applied them — they each rewrite sqlite_master, which is the slow path.
    let user_version: i32 = conn
        .query_row("SELECT user_version FROM pragma_user_version", [], |row| row.get(0))
        .unwrap_or(0);

    if user_version < SCHEMA_VERSION {
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

        // New columns for enriched camera/lens/video metadata
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN camera_make TEXT", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN camera_model TEXT", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN lens_model TEXT", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN iso INTEGER", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN aperture REAL", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN shutter_us INTEGER", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN focal_length_mm REAL", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN orientation INTEGER", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN duration_ms INTEGER", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN codec TEXT", []);

        // Thumbnail generation tracking. NULL = pending, 'ready' = on-disk thumb exists,
        // 'failed' = decoder rejected (e.g. unsupported HEIC), 'unsupported' = video.
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN thumb_status TEXT", []);

        conn.execute(&format!("PRAGMA user_version = {}", SCHEMA_VERSION), [])?;
    }

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

    // Composite index to support filtering by camera make/model
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_camera ON photos(camera_make, camera_model)",
        [],
    )?;

    // Composite index for cursor-paginated walks (PAGINATION_PLAN.md).
    // Matches the exact ORDER BY of get_photos_page, so the cursor predicate
    // becomes an index seek instead of a full-table scan.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_date_id ON photos(date_taken DESC, id DESC)",
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
    // WAL gives concurrent reads while writing; NORMAL durability is fine for a
    // local desktop app; cache_size negative = KB. These three are the SQLite
    // perf trifecta and pay for themselves on the very first query.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\n\
         PRAGMA synchronous = NORMAL;\n\
         PRAGMA temp_store = MEMORY;\n\
         PRAGMA cache_size = -64000;\n\
         PRAGMA foreign_keys = ON;",
    )?;
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

/// Columns selected by every query that returns PhotoMetadata rows.
/// Order must match the index offsets in photo_from_row.
const PHOTO_COLUMNS: &str =
    "path, name, date_taken, width, height, is_favorite, content_hash, \
     latitude, longitude, location_name, \
     camera_make, camera_model, lens_model, iso, aperture, shutter_us, \
     focal_length_mm, orientation, duration_ms, codec, thumb_status";

/// Map a row produced by PHOTO_COLUMNS into a PhotoMetadata.
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
        camera_make: row.get(10)?,
        camera_model: row.get(11)?,
        lens_model: row.get(12)?,
        iso: row.get(13)?,
        aperture: row.get(14)?,
        shutter_us: row.get(15)?,
        focal_length_mm: row.get(16)?,
        orientation: row.get(17)?,
        duration_ms: row.get(18)?,
        codec: row.get(19)?,
        thumb_status: row.get(20)?,
    })
}

/// Get all photos from the database, sorted by date_taken descending
pub fn get_all_photos(conn: &Connection) -> SqlResult<Vec<PhotoMetadata>> {
    let query = format!("SELECT {} FROM photos ORDER BY date_taken DESC", PHOTO_COLUMNS);
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], photo_from_row)?;
    rows.collect()
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
    let rows = stmt.query_map([], |row| Ok(Album {
        id: row.get(0)?,
        name: row.get(1)?,
        cover_photo_path: row.get(2)?,
        count: row.get(3)?,
    }))?;
    rows.collect()
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
    let query = format!(
        "SELECT {} FROM photos \
         WHERE content_hash IN ( \
             SELECT content_hash FROM photos GROUP BY content_hash HAVING COUNT(*) > 1 \
         ) \
         ORDER BY content_hash, date_taken DESC",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], photo_from_row)?;
    rows.collect()
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

// ============================================================================
// TerraForm (Review Mode) Functions
// ============================================================================

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
    let rows = stmt.query_map([], |row| Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        count: row.get(3)?,
    }))?;
    rows.collect()
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
    let rows = stmt.query_map(params![path], |row| Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        count: row.get(3)?,
    }))?;
    rows.collect()
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

    let photo_cols = "p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, \
                      p.latitude, p.longitude, p.location_name, \
                      p.camera_make, p.camera_model, p.lens_model, p.iso, p.aperture, p.shutter_us, \
                      p.focal_length_mm, p.orientation, p.duration_ms, p.codec, p.thumb_status";
    let query = if match_all {
        // AND logic: photo must have ALL specified tags
        format!(
            "SELECT {} FROM photos p \
             JOIN photo_tags pt ON p.path = pt.photo_path \
             WHERE pt.tag_id IN ({}) AND p.archived_at IS NULL \
             GROUP BY p.path \
             HAVING COUNT(DISTINCT pt.tag_id) = ? \
             ORDER BY p.date_taken DESC",
            photo_cols, placeholder_str
        )
    } else {
        // OR logic: photo must have ANY of the specified tags
        format!(
            "SELECT DISTINCT {} FROM photos p \
             JOIN photo_tags pt ON p.path = pt.photo_path \
             WHERE pt.tag_id IN ({}) AND p.archived_at IS NULL \
             ORDER BY p.date_taken DESC",
            photo_cols, placeholder_str
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

    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())), photo_from_row)?;
    rows.collect()
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
    let rows = stmt.query_map(params![search_term], |row| Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        count: row.get(3)?,
    }))?;
    rows.collect()
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

// ============================================================================
// Pagination (PAGINATION_PLAN.md)
// ============================================================================

/// SQL fragment that's true for video files (alias `p` for the `photos`
/// table). Used by both view counts and page filters.
const IS_VIDEO_SQL: &str = "(LOWER(p.name) LIKE '%.mp4' OR \
     LOWER(p.name) LIKE '%.mov' OR \
     LOWER(p.name) LIKE '%.avi' OR \
     LOWER(p.name) LIKE '%.webm' OR \
     LOWER(p.name) LIKE '%.mkv')";

/// Same fragment but using the bare `photos` table (no alias). Kept around
/// for callers that don't alias, e.g. `get_view_counts`.
const IS_VIDEO_SQL_UNALIASED: &str = "(LOWER(name) LIKE '%.mp4' OR \
     LOWER(name) LIKE '%.mov' OR \
     LOWER(name) LIKE '%.avi' OR \
     LOWER(name) LIKE '%.webm' OR \
     LOWER(name) LIKE '%.mkv')";

/// All paginated queries SELECT these columns from `photos` aliased as `p`,
/// in the exact order `photo_from_row` expects, followed by `p.id` as the
/// trailing column for cursor extraction.
const PAGINATED_SELECT: &str =
    "p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, \
     p.latitude, p.longitude, p.location_name, \
     p.camera_make, p.camera_model, p.lens_model, p.iso, p.aperture, p.shutter_us, \
     p.focal_length_mm, p.orientation, p.duration_ms, p.codec, p.thumb_status, p.id";

/// Per-filter SQL contribution: optional JOIN clause(s), a WHERE fragment
/// (referencing `p.` and any joined-table aliases), and the bound params for
/// any `?` placeholders the WHERE introduces.
struct FilterSql {
    /// Empty string for filters that only need the photos table; otherwise a
    /// space-prefixed JOIN clause (e.g. " JOIN photo_tags pt ON p.path = pt.photo_path").
    joins: String,
    /// WHERE fragment. Must reference columns via `p.` or joined-table aliases.
    clause: String,
    /// Parameters bound in left-to-right `?` order within `joins + clause`.
    params: Vec<Box<dyn rusqlite::ToSql>>,
}

/// Translate a `ViewFilter` into the SQL contribution for `get_photos_page`.
fn build_filter_sql(filter: &ViewFilter) -> FilterSql {
    match filter {
        ViewFilter::All => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NULL".to_string(),
            params: Vec::new(),
        },
        ViewFilter::Favorites => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NULL AND p.is_favorite = 1".to_string(),
            params: Vec::new(),
        },
        ViewFilter::Archived => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NOT NULL".to_string(),
            params: Vec::new(),
        },
        ViewFilter::Unreviewed => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NULL AND p.reviewed_at IS NULL".to_string(),
            params: Vec::new(),
        },
        ViewFilter::PhotosOnly => FilterSql {
            joins: String::new(),
            clause: format!("p.archived_at IS NULL AND NOT {}", IS_VIDEO_SQL),
            params: Vec::new(),
        },
        ViewFilter::VideosOnly => FilterSql {
            joins: String::new(),
            clause: format!("p.archived_at IS NULL AND {}", IS_VIDEO_SQL),
            params: Vec::new(),
        },
        ViewFilter::Tag { id } => FilterSql {
            joins: " JOIN photo_tags pt ON p.path = pt.photo_path".to_string(),
            clause: "p.archived_at IS NULL AND pt.tag_id = ?".to_string(),
            params: vec![Box::new(*id)],
        },
        ViewFilter::Album { id } => FilterSql {
            joins: " JOIN album_photos ap ON p.path = ap.photo_path".to_string(),
            clause: "p.archived_at IS NULL AND ap.album_id = ?".to_string(),
            params: vec![Box::new(*id)],
        },
        ViewFilter::Location { name } => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NULL AND p.location_name = ?".to_string(),
            params: vec![Box::new(name.clone())],
        },
        ViewFilter::Search { query } => {
            let term = format!("%{}%", query);
            FilterSql {
                joins: String::new(),
                clause: "p.archived_at IS NULL AND (p.name LIKE ? OR p.location_name LIKE ?)".to_string(),
                params: vec![Box::new(term.clone()), Box::new(term)],
            }
        }
        ViewFilter::SmartCollection { id } => smart_collection_filter_sql(id),
    }
}

/// Map a smart-collection id to a `FilterSql`. Size buckets are scoped by
/// `file_size` thresholds but ordered by `date_taken DESC` so the
/// `(date_taken, id)` cursor stays valid; rows inside each bucket appear
/// chronologically rather than biggest-first.
fn smart_collection_filter_sql(id: &str) -> FilterSql {
    let now = chrono::Utc::now().timestamp();
    let seven_days_ago = now - 7 * 24 * 60 * 60;
    let thirty_days_ago = now - 30 * 24 * 60 * 60;
    let current_year = chrono::Utc::now().format("%Y").to_string();

    let none = || (String::new(), Vec::<Box<dyn rusqlite::ToSql>>::new());

    let (clause, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = match id {
        "size_large" => ("p.file_size > 5242880".to_string(), none().1),
        "size_medium" => ("p.file_size BETWEEN 1048576 AND 5242880".to_string(), none().1),
        "size_small" => ("p.file_size < 1048576 AND p.file_size > 0".to_string(), none().1),
        "dim_4k" => ("(p.width >= 3840 OR p.height >= 2160)".to_string(), none().1),
        "dim_hd" => (
            "(p.width >= 1920 OR p.height >= 1080) AND p.width < 3840 AND p.height < 2160".to_string(),
            none().1,
        ),
        "dim_portrait" => ("p.height > p.width AND p.width > 0".to_string(), none().1),
        "dim_landscape" => ("p.width > p.height AND p.height > 0".to_string(), none().1),
        "status_unreviewed" => ("p.reviewed_at IS NULL".to_string(), none().1),
        "time_7days" => (
            "p.date_taken > ?".to_string(),
            vec![Box::new(seven_days_ago) as Box<dyn rusqlite::ToSql>],
        ),
        "time_30days" => (
            "p.date_taken > ?".to_string(),
            vec![Box::new(thirty_days_ago) as Box<dyn rusqlite::ToSql>],
        ),
        "time_year" => (
            "strftime('%Y', p.date_taken, 'unixepoch') = ?".to_string(),
            vec![Box::new(current_year) as Box<dyn rusqlite::ToSql>],
        ),
        // Unknown collection id → match nothing rather than match everything.
        _ => ("1 = 0".to_string(), none().1),
    };

    FilterSql {
        joins: String::new(),
        clause: format!("p.archived_at IS NULL AND {}", clause),
        params,
    }
}

/// Cursor-paginated photo query.
///
/// Returns up to `limit` rows in DESC order on `(p.date_taken, p.id)`.
/// Internally fetches `limit + 1` to detect whether more pages exist without
/// a separate COUNT round-trip; the extra row is dropped from the response
/// and the last kept row's position becomes `next_cursor`.
///
/// Cursors are exclusive: the next page query is strictly less than this
/// position, which keeps the walk stable across deletes between calls.
pub fn get_photos_page(
    conn: &Connection,
    filter: &ViewFilter,
    cursor: Option<&Cursor>,
    limit: i64,
) -> SqlResult<PageResult> {
    if limit <= 0 {
        return Ok(PageResult { photos: Vec::new(), next_cursor: None });
    }

    let f = build_filter_sql(filter);
    let limit_plus_one = limit + 1;

    let mut sql = format!(
        "SELECT {} FROM photos p{} WHERE {}",
        PAGINATED_SELECT, f.joins, f.clause
    );
    // Build params in left-to-right `?` order: filter params, optional
    // cursor params, then limit. This avoids juggling named placeholders.
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = f.params;
    if let Some(c) = cursor {
        sql.push_str(" AND (p.date_taken < ? OR (p.date_taken = ? AND p.id < ?))");
        bound.push(Box::new(c.date_taken));
        bound.push(Box::new(c.date_taken));
        bound.push(Box::new(c.id));
    }
    sql.push_str(" ORDER BY p.date_taken DESC, p.id DESC LIMIT ?");
    bound.push(Box::new(limit_plus_one));

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(PhotoMetadata, i64)> = stmt
        .query_map(
            rusqlite::params_from_iter(bound.iter().map(|p| p.as_ref())),
            |row| Ok((photo_from_row(row)?, row.get::<_, i64>(21)?)),
        )?
        .collect::<SqlResult<Vec<_>>>()?;

    let (photos, next_cursor) = if rows.len() > limit as usize {
        // limit+1 came back — at least one more page exists. Drop the
        // probe row; the last kept row's (date_taken, id) anchors the
        // next page boundary.
        let mut kept: Vec<(PhotoMetadata, i64)> = rows;
        kept.truncate(limit as usize);
        let (last_photo, last_id) = kept.last().expect("limit > 0 means kept is non-empty");
        let next = Cursor { date_taken: last_photo.date_taken, id: *last_id };
        (kept.into_iter().map(|(p, _)| p).collect(), Some(next))
    } else {
        (rows.into_iter().map(|(p, _)| p).collect(), None)
    };

    Ok(PageResult { photos, next_cursor })
}

/// Top-level counts the sidebar reads instead of `photos.length`, plus
/// per-album / per-tag / per-smart-collection maps for badges.
pub fn get_view_counts(conn: &Connection) -> SqlResult<ViewCounts> {
    let scalar = |sql: &str| -> SqlResult<i64> {
        conn.query_row(sql, [], |row| row.get(0))
    };

    let mut counts = ViewCounts::default();
    counts.all = scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL")?;
    counts.favorites =
        scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND is_favorite = 1")?;
    counts.archived = scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NOT NULL")?;
    counts.unreviewed =
        scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND reviewed_at IS NULL")?;
    counts.videos_only = scalar(&format!(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND {}",
        IS_VIDEO_SQL_UNALIASED
    ))?;
    counts.photos_only = scalar(&format!(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND NOT {}",
        IS_VIDEO_SQL_UNALIASED
    ))?;

    // by_album: one row per album that contains at least one non-archived
    // photo. Albums with zero non-archived members aren't listed here; the
    // sidebar's get_albums fetcher already shows them with count = 0.
    let mut album_stmt = conn.prepare(
        "SELECT ap.album_id, COUNT(*) FROM album_photos ap \
         JOIN photos p ON p.path = ap.photo_path \
         WHERE p.archived_at IS NULL \
         GROUP BY ap.album_id",
    )?;
    let album_rows = album_stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?.to_string(), row.get::<_, i64>(1)?))
    })?;
    for row in album_rows {
        let (k, v) = row?;
        counts.by_album.insert(k, v);
    }

    let mut tag_stmt = conn.prepare(
        "SELECT pt.tag_id, COUNT(*) FROM photo_tags pt \
         JOIN photos p ON p.path = pt.photo_path \
         WHERE p.archived_at IS NULL \
         GROUP BY pt.tag_id",
    )?;
    let tag_rows = tag_stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?.to_string(), row.get::<_, i64>(1)?))
    })?;
    for row in tag_rows {
        let (k, v) = row?;
        counts.by_tag.insert(k, v);
    }

    // Smart collections — reuse the filter SQL builder so counts and page
    // queries can never disagree on what each collection means.
    for id in [
        "size_large", "size_medium", "size_small",
        "dim_4k", "dim_hd", "dim_portrait", "dim_landscape",
        "time_7days", "time_30days", "time_year",
        "status_unreviewed",
    ] {
        let f = smart_collection_filter_sql(id);
        let sql = format!("SELECT COUNT(*) FROM photos p WHERE {}", f.clause);
        let count: i64 = conn.query_row(
            &sql,
            rusqlite::params_from_iter(f.params.iter().map(|p| p.as_ref())),
            |row| row.get(0),
        )?;
        counts.by_smart_collection.insert(id.to_string(), count);
    }

    Ok(counts)
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
            camera_make: None,
            camera_model: None,
            lens_model: None,
            iso: None,
            aperture: None,
            shutter_us: None,
            focal_length_mm: None,
            orientation: None,
            duration_ms: None,
            codec: None,
            thumb_status: None,
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
    fn test_delete_photo() {
        let conn = setup_db();
        let photo = test_photo("/photos/delete_me.jpg", "delete_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();
        assert_eq!(get_all_photos(&conn).unwrap().len(), 1);

        delete_photo(&conn, "/photos/delete_me.jpg").unwrap();
        assert_eq!(get_all_photos(&conn).unwrap().len(), 0);
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

        let result = get_photos_page(&conn, &ViewFilter::Album { id: album_id }, None, 50).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/photos/album_pic.jpg");
    }

    #[test]
    fn test_remove_photo_from_album() {
        let conn = setup_db();
        let photo = test_photo("/photos/remove_me.jpg", "remove_me.jpg");
        insert_photo(&conn, &photo, "upload").unwrap();

        let album_id = create_album(&conn, "Temp").unwrap();
        add_photo_to_album(&conn, album_id, "/photos/remove_me.jpg").unwrap();
        let before = get_photos_page(&conn, &ViewFilter::Album { id: album_id }, None, 50).unwrap();
        assert_eq!(before.photos.len(), 1);

        remove_photo_from_album(&conn, album_id, "/photos/remove_me.jpg").unwrap();
        let after = get_photos_page(&conn, &ViewFilter::Album { id: album_id }, None, 50).unwrap();
        assert_eq!(after.photos.len(), 0);
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

    // ====================================================================
    // Pagination tests (PAGINATION_PLAN.md, P.1)
    // ====================================================================

    /// Insert a photo whose date_taken we control. Used by pagination tests
    /// to walk a deterministic ordering and to construct tied dates.
    fn insert_dated(conn: &Connection, path: &str, name: &str, date_taken: i64) {
        let mut p = test_photo(path, name);
        p.date_taken = date_taken;
        insert_photo(conn, &p, "upload").unwrap();
    }

    #[test]
    fn paged_empty_library_returns_no_cursor() {
        let conn = setup_db();
        let result = get_photos_page(&conn, &ViewFilter::All, None, 50).unwrap();
        assert!(result.photos.is_empty());
        assert!(result.next_cursor.is_none());
    }

    #[test]
    fn paged_under_limit_returns_no_cursor() {
        let conn = setup_db();
        for i in 0..3 {
            insert_dated(&conn, &format!("/p/{}.jpg", i), &format!("{}.jpg", i), 1000 + i);
        }
        let result = get_photos_page(&conn, &ViewFilter::All, None, 10).unwrap();
        assert_eq!(result.photos.len(), 3);
        assert!(result.next_cursor.is_none());
    }

    #[test]
    fn paged_exact_limit_returns_no_cursor() {
        let conn = setup_db();
        for i in 0..5 {
            insert_dated(&conn, &format!("/p/{}.jpg", i), &format!("{}.jpg", i), 1000 + i);
        }
        let result = get_photos_page(&conn, &ViewFilter::All, None, 5).unwrap();
        assert_eq!(result.photos.len(), 5);
        assert!(
            result.next_cursor.is_none(),
            "exactly `limit` rows means no further page exists"
        );
    }

    #[test]
    fn paged_walk_visits_every_row_exactly_once() {
        let conn = setup_db();
        // 12 rows with distinct dates, walked in pages of 5 → 5 + 5 + 2.
        for i in 0..12 {
            insert_dated(&conn, &format!("/p/{:02}.jpg", i), &format!("{:02}.jpg", i), 1000 + i);
        }

        let mut seen: Vec<String> = Vec::new();
        let mut cursor: Option<Cursor> = None;
        loop {
            let result = get_photos_page(&conn, &ViewFilter::All, cursor.as_ref(), 5).unwrap();
            seen.extend(result.photos.iter().map(|p| p.path.clone()));
            match result.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }

        assert_eq!(seen.len(), 12, "must see every row exactly once");
        let mut deduped = seen.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(deduped.len(), 12, "no row should appear twice");

        // Order is DESC by date_taken — newest path "11.jpg" first, oldest last.
        assert_eq!(seen.first().unwrap(), "/p/11.jpg");
        assert_eq!(seen.last().unwrap(), "/p/00.jpg");
    }

    #[test]
    fn paged_handles_ties_on_date_taken() {
        let conn = setup_db();
        // 6 rows all sharing the same date_taken — id is the tie-breaker.
        for i in 0..6 {
            insert_dated(&conn, &format!("/p/tied{}.jpg", i), &format!("tied{}.jpg", i), 2000);
        }
        // Two pages of 3. Cursor in the middle must split the tied group cleanly.
        let first = get_photos_page(&conn, &ViewFilter::All, None, 3).unwrap();
        assert_eq!(first.photos.len(), 3);
        let cursor = first.next_cursor.expect("more rows remain");

        let second = get_photos_page(&conn, &ViewFilter::All, Some(&cursor), 3).unwrap();
        assert_eq!(second.photos.len(), 3);
        assert!(second.next_cursor.is_none());

        // Combined paths must be the full set, no overlap.
        let mut seen: Vec<String> = first.photos.iter().chain(second.photos.iter())
            .map(|p| p.path.clone()).collect();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), 6, "tied dates must not duplicate or skip rows");
    }

    #[test]
    fn paged_excludes_archived_from_all() {
        let conn = setup_db();
        insert_dated(&conn, "/p/keep.jpg", "keep.jpg", 1000);
        insert_dated(&conn, "/p/gone.jpg", "gone.jpg", 1001);
        archive_photo(&conn, "/p/gone.jpg").unwrap();

        let result = get_photos_page(&conn, &ViewFilter::All, None, 50).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/keep.jpg");
    }

    #[test]
    fn paged_zero_limit_is_a_noop() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        let result = get_photos_page(&conn, &ViewFilter::All, None, 0).unwrap();
        assert!(result.photos.is_empty());
        assert!(result.next_cursor.is_none());
    }

    #[test]
    fn view_counts_empty_library() {
        let conn = setup_db();
        let counts = get_view_counts(&conn).unwrap();
        assert_eq!(counts.all, 0);
        assert_eq!(counts.favorites, 0);
        assert_eq!(counts.archived, 0);
        assert_eq!(counts.unreviewed, 0);
        assert_eq!(counts.photos_only, 0);
        assert_eq!(counts.videos_only, 0);
        assert!(counts.by_album.is_empty());
        assert!(counts.by_tag.is_empty());
        // Smart-collection map always has every known id, even when zero.
        assert!(counts.by_smart_collection.contains_key("size_large"));
    }

    #[test]
    fn paged_favorites_filter_only_returns_favorites() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/c.jpg", "c.jpg", 1002);
        set_photo_favorite(&conn, "/p/b.jpg", true).unwrap();
        set_photo_favorite(&conn, "/p/c.jpg", true).unwrap();

        let result = get_photos_page(&conn, &ViewFilter::Favorites, None, 50).unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/c.jpg", "/p/b.jpg"]);
    }

    #[test]
    fn paged_archived_filter_only_returns_archived() {
        let conn = setup_db();
        insert_dated(&conn, "/p/keep.jpg", "keep.jpg", 1000);
        insert_dated(&conn, "/p/gone.jpg", "gone.jpg", 1001);
        archive_photo(&conn, "/p/gone.jpg").unwrap();

        let result = get_photos_page(&conn, &ViewFilter::Archived, None, 50).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/gone.jpg");
    }

    #[test]
    fn paged_unreviewed_filter_excludes_reviewed_and_archived() {
        let conn = setup_db();
        insert_dated(&conn, "/p/new.jpg", "new.jpg", 1000);
        insert_dated(&conn, "/p/seen.jpg", "seen.jpg", 1001);
        insert_dated(&conn, "/p/dead.jpg", "dead.jpg", 1002);
        mark_photo_reviewed(&conn, "/p/seen.jpg").unwrap();
        archive_photo(&conn, "/p/dead.jpg").unwrap();

        let result = get_photos_page(&conn, &ViewFilter::Unreviewed, None, 50).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/new.jpg");
    }

    #[test]
    fn paged_videos_only_returns_videos_by_extension() {
        let conn = setup_db();
        insert_dated(&conn, "/p/photo.jpg", "photo.jpg", 1000);
        insert_dated(&conn, "/p/clip.MP4", "clip.MP4", 1001); // case-insensitive
        insert_dated(&conn, "/p/movie.mov", "movie.mov", 1002);

        let result = get_photos_page(&conn, &ViewFilter::VideosOnly, None, 50).unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/movie.mov", "/p/clip.MP4"]);
    }

    #[test]
    fn paged_photos_only_excludes_videos() {
        let conn = setup_db();
        insert_dated(&conn, "/p/photo.jpg", "photo.jpg", 1000);
        insert_dated(&conn, "/p/clip.mp4", "clip.mp4", 1001);

        let result = get_photos_page(&conn, &ViewFilter::PhotosOnly, None, 50).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/photo.jpg");
    }

    #[test]
    fn paged_tag_filter_returns_only_tagged_photos() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/c.jpg", "c.jpg", 1002);

        let nature = create_tag(&conn, "nature", "#0f0").unwrap();
        let urban = create_tag(&conn, "urban", "#f00").unwrap();
        add_tags_to_photos(&conn, &[nature], &["/p/a.jpg".to_string(), "/p/c.jpg".to_string()]).unwrap();
        add_tags_to_photos(&conn, &[urban], &["/p/b.jpg".to_string()]).unwrap();

        let result = get_photos_page(&conn, &ViewFilter::Tag { id: nature }, None, 50).unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/c.jpg", "/p/a.jpg"]);
    }

    #[test]
    fn paged_album_filter_returns_only_album_members() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/c.jpg", "c.jpg", 1002);

        let trip = create_album(&conn, "Trip").unwrap();
        add_photo_to_album(&conn, trip, "/p/a.jpg").unwrap();
        add_photo_to_album(&conn, trip, "/p/c.jpg").unwrap();

        let result = get_photos_page(&conn, &ViewFilter::Album { id: trip }, None, 50).unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/c.jpg", "/p/a.jpg"]);
    }

    #[test]
    fn paged_location_filter_matches_location_name_exactly() {
        let conn = setup_db();
        let mut a = test_photo("/p/paris.jpg", "paris.jpg");
        a.date_taken = 1000;
        a.location_name = Some("Paris, France".to_string());
        insert_photo(&conn, &a, "upload").unwrap();

        let mut b = test_photo("/p/tokyo.jpg", "tokyo.jpg");
        b.date_taken = 1001;
        b.location_name = Some("Tokyo, Japan".to_string());
        insert_photo(&conn, &b, "upload").unwrap();

        let result = get_photos_page(
            &conn,
            &ViewFilter::Location { name: "Paris, France".to_string() },
            None,
            50,
        ).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/paris.jpg");
    }

    #[test]
    fn paged_search_filter_matches_name_or_location_substring() {
        let conn = setup_db();
        let mut sunset = test_photo("/p/sunset_beach.jpg", "sunset_beach.jpg");
        sunset.date_taken = 1000;
        insert_photo(&conn, &sunset, "upload").unwrap();

        let mut paris = test_photo("/p/photo.jpg", "photo.jpg");
        paris.date_taken = 1001;
        paris.location_name = Some("Paris, France".to_string());
        insert_photo(&conn, &paris, "upload").unwrap();

        let result_name = get_photos_page(
            &conn,
            &ViewFilter::Search { query: "sunset".to_string() },
            None,
            50,
        ).unwrap();
        assert_eq!(result_name.photos.len(), 1);
        assert_eq!(result_name.photos[0].path, "/p/sunset_beach.jpg");

        let result_location = get_photos_page(
            &conn,
            &ViewFilter::Search { query: "Paris".to_string() },
            None,
            50,
        ).unwrap();
        assert_eq!(result_location.photos.len(), 1);
        assert_eq!(result_location.photos[0].path, "/p/photo.jpg");
    }

    #[test]
    fn paged_smart_collection_unknown_id_matches_nothing() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);

        let result = get_photos_page(
            &conn,
            &ViewFilter::SmartCollection { id: "totally_made_up".to_string() },
            None,
            50,
        ).unwrap();
        assert!(result.photos.is_empty());
    }

    #[test]
    fn paged_smart_collection_size_large_filters_by_threshold() {
        let conn = setup_db();
        // 6 MB photo — qualifies as "large".
        let mut big = test_photo("/p/big.jpg", "big.jpg");
        big.date_taken = 1000;
        insert_photo(&conn, &big, "upload").unwrap();
        update_photo_file_size(&conn, "/p/big.jpg", 6 * 1024 * 1024).unwrap();

        // 100 KB photo — does not qualify.
        let mut tiny = test_photo("/p/tiny.jpg", "tiny.jpg");
        tiny.date_taken = 1001;
        insert_photo(&conn, &tiny, "upload").unwrap();
        update_photo_file_size(&conn, "/p/tiny.jpg", 100 * 1024).unwrap();

        let result = get_photos_page(
            &conn,
            &ViewFilter::SmartCollection { id: "size_large".to_string() },
            None,
            50,
        ).unwrap();
        assert_eq!(result.photos.len(), 1);
        assert_eq!(result.photos[0].path, "/p/big.jpg");
    }

    #[test]
    fn paged_filter_pages_walk_through_all_matches() {
        // Confirms cursor + filter compose: walking the favorites view across
        // multiple pages must visit every favorite exactly once.
        let conn = setup_db();
        for i in 0..10 {
            insert_dated(&conn, &format!("/p/{:02}.jpg", i), &format!("{:02}.jpg", i), 1000 + i);
            if i % 2 == 0 {
                set_photo_favorite(&conn, &format!("/p/{:02}.jpg", i), true).unwrap();
            }
        }

        let mut seen = Vec::new();
        let mut cursor: Option<Cursor> = None;
        loop {
            let result = get_photos_page(&conn, &ViewFilter::Favorites, cursor.as_ref(), 2).unwrap();
            seen.extend(result.photos.iter().map(|p| p.path.clone()));
            match result.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        // 5 favorites: indices 0,2,4,6,8.
        assert_eq!(seen.len(), 5);
        let mut deduped = seen.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(deduped.len(), 5);
    }

    #[test]
    fn view_counts_partition_correctly() {
        let conn = setup_db();
        // 2 plain photos, 1 favorite photo, 1 video, 1 archived photo.
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/fav.jpg", "fav.jpg", 1002);
        set_photo_favorite(&conn, "/p/fav.jpg", true).unwrap();
        insert_dated(&conn, "/p/clip.mp4", "clip.mp4", 1003);
        insert_dated(&conn, "/p/old.jpg", "old.jpg", 999);
        archive_photo(&conn, "/p/old.jpg").unwrap();
        // Mark one as reviewed so unreviewed != all.
        mark_photo_reviewed(&conn, "/p/a.jpg").unwrap();

        let counts = get_view_counts(&conn).unwrap();
        // a, b, fav, clip — old is archived so excluded.
        assert_eq!(counts.all, 4);
        assert_eq!(counts.favorites, 1);
        assert_eq!(counts.archived, 1);
        // a was marked reviewed; b, fav, clip remain unreviewed.
        assert_eq!(counts.unreviewed, 3);
        assert_eq!(counts.videos_only, 1);
        assert_eq!(counts.photos_only, 3);
    }

    #[test]
    fn view_counts_by_album_excludes_archived_members() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/c.jpg", "c.jpg", 1002);
        let trip = create_album(&conn, "Trip").unwrap();
        add_photo_to_album(&conn, trip, "/p/a.jpg").unwrap();
        add_photo_to_album(&conn, trip, "/p/b.jpg").unwrap();
        add_photo_to_album(&conn, trip, "/p/c.jpg").unwrap();
        archive_photo(&conn, "/p/c.jpg").unwrap();

        let counts = get_view_counts(&conn).unwrap();
        assert_eq!(counts.by_album.get(&trip.to_string()).copied(), Some(2));
    }

    #[test]
    fn view_counts_by_tag_excludes_archived_members() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        let nature = create_tag(&conn, "nature", "#0f0").unwrap();
        add_tags_to_photos(&conn, &[nature], &["/p/a.jpg".into(), "/p/b.jpg".into()]).unwrap();
        archive_photo(&conn, "/p/b.jpg").unwrap();

        let counts = get_view_counts(&conn).unwrap();
        assert_eq!(counts.by_tag.get(&nature.to_string()).copied(), Some(1));
    }

    #[test]
    fn view_counts_by_smart_collection_uses_filter_sql() {
        let conn = setup_db();
        // 6 MB photo qualifies for size_large.
        let mut big = test_photo("/p/big.jpg", "big.jpg");
        big.date_taken = 1000;
        insert_photo(&conn, &big, "upload").unwrap();
        update_photo_file_size(&conn, "/p/big.jpg", 6 * 1024 * 1024).unwrap();

        let counts = get_view_counts(&conn).unwrap();
        assert_eq!(counts.by_smart_collection.get("size_large").copied(), Some(1));
        assert_eq!(counts.by_smart_collection.get("size_small").copied(), Some(0));
    }
}
