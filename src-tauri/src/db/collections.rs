use rusqlite::{Connection, Result as SqlResult, params};

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
