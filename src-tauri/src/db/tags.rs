use rusqlite::{Connection, Result as SqlResult, params};
use crate::PhotoMetadata;
use super::row::photo_from_row;

#[derive(serde::Serialize)]
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
