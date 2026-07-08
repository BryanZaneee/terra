use rusqlite::{Connection, Result as SqlResult, params};

#[derive(serde::Serialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

/// Map a `(id, name, color, count)` row to a Tag.
fn tag_from_row(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        count: row.get(3)?,
    })
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
    let rows = stmt.query_map([], tag_from_row)?;
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
    let rows = stmt.query_map(params![path], tag_from_row)?;
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
    let rows = stmt.query_map(params![search_term], tag_from_row)?;
    rows.collect()
}
