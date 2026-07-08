use rusqlite::{Connection, Result as SqlResult, params};
use std::path::PathBuf;
use dirs;

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

