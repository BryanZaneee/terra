mod row;
mod schema;
mod photos;
mod albums;
mod scan;
mod archive;
mod review;
mod tags;
mod collections;
mod analytics;
mod pagination;

pub use schema::*;
pub use photos::*;
pub use albums::*;
pub use scan::*;
pub use archive::*;
pub use review::*;
pub use tags::*;
pub use collections::*;
pub use analytics::*;
pub use pagination::{get_photos_page, get_view_counts};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Cursor, PhotoMetadata, ViewFilter};
    use rusqlite::Connection;

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

        let result = get_photos_page(
            &conn,
            &ViewFilter::Tags {
                ids: vec![nature],
                match_all: false,
            },
            None,
            50,
        )
        .unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/c.jpg", "/p/a.jpg"]);
    }

    #[test]
    fn paged_multi_tag_or_returns_union_deduped() {
        let conn = setup_db();
        insert_dated(&conn, "/p/a.jpg", "a.jpg", 1000);
        insert_dated(&conn, "/p/b.jpg", "b.jpg", 1001);
        insert_dated(&conn, "/p/c.jpg", "c.jpg", 1002);

        let t1 = create_tag(&conn, "t1", "#0f0").unwrap();
        let t2 = create_tag(&conn, "t2", "#f00").unwrap();
        add_tags_to_photos(&conn, &[t1], &["/p/a.jpg".to_string()]).unwrap();
        add_tags_to_photos(&conn, &[t2], &["/p/b.jpg".to_string(), "/p/c.jpg".to_string()]).unwrap();

        let result = get_photos_page(
            &conn,
            &ViewFilter::Tags {
                ids: vec![t1, t2],
                match_all: false,
            },
            None,
            50,
        )
        .unwrap();
        let paths: Vec<&str> = result.photos.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["/p/c.jpg", "/p/b.jpg", "/p/a.jpg"]);
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
