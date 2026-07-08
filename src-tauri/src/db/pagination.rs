use rusqlite::{Connection, Result as SqlResult};
use crate::{Cursor, PageResult, PhotoMetadata, ViewCounts, ViewFilter};
use super::row::photo_from_row;

/// SQL fragment that's true for video files (alias `p` for the `photos`
/// table). Used by both view counts and page filters.
const IS_VIDEO_SQL: &str = "(LOWER(p.name) LIKE '%.mp4' OR \
     LOWER(p.name) LIKE '%.mov' OR \
     LOWER(p.name) LIKE '%.avi' OR \
     LOWER(p.name) LIKE '%.webm' OR \
     LOWER(p.name) LIKE '%.mkv')";

/// Same fragment but using the bare `photos` table (no alias).
const IS_VIDEO_SQL_UNALIASED: &str = "(LOWER(name) LIKE '%.mp4' OR \
     LOWER(name) LIKE '%.mov' OR \
     LOWER(name) LIKE '%.avi' OR \
     LOWER(name) LIKE '%.webm' OR \
     LOWER(name) LIKE '%.mkv')";

const PAGINATED_SELECT: &str =
    "p.path, p.name, p.date_taken, p.width, p.height, p.is_favorite, p.content_hash, \
     p.latitude, p.longitude, p.location_name, \
     p.camera_make, p.camera_model, p.lens_model, p.iso, p.aperture, p.shutter_us, \
     p.focal_length_mm, p.orientation, p.duration_ms, p.codec, p.thumb_status, p.id";

struct FilterSql {
    joins: String,
    clause: String,
    params: Vec<Box<dyn rusqlite::ToSql>>,
    /// e.g. ` GROUP BY p.id` for multi-tag dedup
    group_by: String,
    /// e.g. ` HAVING COUNT(DISTINCT pt.tag_id) = ?`
    having: String,
    having_params: Vec<Box<dyn rusqlite::ToSql>>,
}

impl FilterSql {
    fn simple(clause: impl Into<String>) -> Self {
        Self {
            joins: String::new(),
            clause: clause.into(),
            params: Vec::new(),
            group_by: String::new(),
            having: String::new(),
            having_params: Vec::new(),
        }
    }
}

fn tags_filter_sql(ids: &[i64], match_all: bool) -> FilterSql {
    if ids.is_empty() {
        return FilterSql::simple("1 = 0");
    }
    let placeholders = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> =
        ids.iter().map(|id| Box::new(*id) as Box<dyn rusqlite::ToSql>).collect();
    let (having, having_params) = if match_all {
        (
            " HAVING COUNT(DISTINCT pt.tag_id) = ?".to_string(),
            vec![Box::new(ids.len() as i64) as Box<dyn rusqlite::ToSql>],
        )
    } else {
        (String::new(), Vec::new())
    };
    FilterSql {
        joins: " INNER JOIN photo_tags pt ON p.path = pt.photo_path".to_string(),
        clause: format!("p.archived_at IS NULL AND pt.tag_id IN ({placeholders})"),
        params,
        group_by: " GROUP BY p.id".to_string(),
        having,
        having_params,
    }
}

fn build_filter_sql(filter: &ViewFilter) -> FilterSql {
    match filter {
        ViewFilter::All => FilterSql::simple("p.archived_at IS NULL"),
        ViewFilter::Favorites => FilterSql::simple("p.archived_at IS NULL AND p.is_favorite = 1"),
        ViewFilter::Archived => FilterSql::simple("p.archived_at IS NOT NULL"),
        ViewFilter::Unreviewed => {
            FilterSql::simple("p.archived_at IS NULL AND p.reviewed_at IS NULL")
        }
        ViewFilter::PhotosOnly => FilterSql::simple(format!(
            "p.archived_at IS NULL AND NOT {IS_VIDEO_SQL}"
        )),
        ViewFilter::VideosOnly => {
            FilterSql::simple(format!("p.archived_at IS NULL AND {IS_VIDEO_SQL}"))
        }
        ViewFilter::Tags { ids, match_all } => tags_filter_sql(ids, *match_all),
        ViewFilter::Album { id } => FilterSql {
            joins: " JOIN album_photos ap ON p.path = ap.photo_path".to_string(),
            clause: "p.archived_at IS NULL AND ap.album_id = ?".to_string(),
            params: vec![Box::new(*id)],
            group_by: String::new(),
            having: String::new(),
            having_params: Vec::new(),
        },
        ViewFilter::Location { name } => FilterSql {
            joins: String::new(),
            clause: "p.archived_at IS NULL AND p.location_name = ?".to_string(),
            params: vec![Box::new(name.clone())],
            group_by: String::new(),
            having: String::new(),
            having_params: Vec::new(),
        },
        ViewFilter::Search { query } => {
            let term = format!("%{query}%");
            FilterSql {
                joins: String::new(),
                clause: "p.archived_at IS NULL AND (p.name LIKE ? OR p.location_name LIKE ?)"
                    .to_string(),
                params: vec![Box::new(term.clone()), Box::new(term)],
                group_by: String::new(),
                having: String::new(),
                having_params: Vec::new(),
            }
        }
        ViewFilter::SmartCollection { id } => smart_collection_filter_sql(id),
    }
}

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
            "(p.width >= 1920 OR p.height >= 1080) AND p.width < 3840 AND p.height < 2160"
                .to_string(),
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
        _ => ("1 = 0".to_string(), none().1),
    };

    FilterSql {
        joins: String::new(),
        clause: format!("p.archived_at IS NULL AND {clause}"),
        params,
        group_by: String::new(),
        having: String::new(),
        having_params: Vec::new(),
    }
}

pub fn get_photos_page(
    conn: &Connection,
    filter: &ViewFilter,
    cursor: Option<&Cursor>,
    limit: i64,
) -> SqlResult<PageResult> {
    if limit <= 0 {
        return Ok(PageResult {
            photos: Vec::new(),
            next_cursor: None,
        });
    }

    let f = build_filter_sql(filter);
    let limit_plus_one = limit + 1;

    let mut sql = format!(
        "SELECT {PAGINATED_SELECT} FROM photos p{} WHERE {}",
        f.joins, f.clause
    );
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = f.params;
    if let Some(c) = cursor {
        sql.push_str(" AND (p.date_taken < ? OR (p.date_taken = ? AND p.id < ?))");
        bound.push(Box::new(c.date_taken));
        bound.push(Box::new(c.date_taken));
        bound.push(Box::new(c.id));
    }
    sql.push_str(&f.group_by);
    sql.push_str(&f.having);
    bound.extend(f.having_params);
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
        let mut kept: Vec<(PhotoMetadata, i64)> = rows;
        kept.truncate(limit as usize);
        let (last_photo, last_id) = kept.last().expect("limit > 0 means kept is non-empty");
        let next = Cursor {
            date_taken: last_photo.date_taken,
            id: *last_id,
        };
        (
            kept.into_iter().map(|(p, _)| p).collect(),
            Some(next),
        )
    } else {
        (rows.into_iter().map(|(p, _)| p).collect(), None)
    };

    Ok(PageResult { photos, next_cursor })
}

pub fn get_view_counts(conn: &Connection) -> SqlResult<ViewCounts> {
    let scalar = |sql: &str| -> SqlResult<i64> { conn.query_row(sql, [], |row| row.get(0)) };

    let mut counts = ViewCounts::default();
    counts.all = scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL")?;
    counts.favorites =
        scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND is_favorite = 1")?;
    counts.archived = scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NOT NULL")?;
    counts.unreviewed =
        scalar("SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND reviewed_at IS NULL")?;
    counts.videos_only = scalar(&format!(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND {IS_VIDEO_SQL_UNALIASED}"
    ))?;
    counts.photos_only = scalar(&format!(
        "SELECT COUNT(*) FROM photos WHERE archived_at IS NULL AND NOT {IS_VIDEO_SQL_UNALIASED}"
    ))?;

    let mut album_stmt = conn.prepare(
        "SELECT ap.album_id, COUNT(*) FROM album_photos ap \
         JOIN photos p ON p.path = ap.photo_path \
         WHERE p.archived_at IS NULL \
         GROUP BY ap.album_id",
    )?;
    for row in album_stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?.to_string(), row.get::<_, i64>(1)?))
    })? {
        let (k, v) = row?;
        counts.by_album.insert(k, v);
    }

    let mut tag_stmt = conn.prepare(
        "SELECT pt.tag_id, COUNT(*) FROM photo_tags pt \
         JOIN photos p ON p.path = pt.photo_path \
         WHERE p.archived_at IS NULL \
         GROUP BY pt.tag_id",
    )?;
    for row in tag_stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?.to_string(), row.get::<_, i64>(1)?))
    })? {
        let (k, v) = row?;
        counts.by_tag.insert(k, v);
    }

    for id in [
        "size_large", "size_medium", "size_small", "dim_4k", "dim_hd", "dim_portrait",
        "dim_landscape", "time_7days", "time_30days", "time_year", "status_unreviewed",
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
    use crate::ViewFilter;

    #[test]
    fn tags_or_filter_produces_group_by() {
        let f = build_filter_sql(&ViewFilter::Tags {
            ids: vec![1, 2],
            match_all: false,
        });
        assert!(f.group_by.contains("GROUP BY"));
        assert!(f.having.is_empty());
    }

    #[test]
    fn tags_and_filter_produces_having() {
        let f = build_filter_sql(&ViewFilter::Tags {
            ids: vec![1, 2],
            match_all: true,
        });
        assert!(f.having.contains("HAVING"));
        assert_eq!(f.having_params.len(), 1);
    }
}
