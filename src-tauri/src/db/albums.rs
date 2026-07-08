use rusqlite::{Connection, Result as SqlResult, params};

/// Create a new album
pub fn create_album(conn: &Connection, name: &str) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO albums (name, created_at) VALUES (?1, ?2)",
        params![name, chrono::Utc::now().timestamp()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Add a photo to an album
pub fn add_photo_to_album(conn: &Connection, album_id: i64, photo_path: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO album_photos (album_id, photo_path, added_at) VALUES (?1, ?2, ?3)",
        params![album_id, photo_path, chrono::Utc::now().timestamp()],
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
