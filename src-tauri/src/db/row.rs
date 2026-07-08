use crate::PhotoMetadata;

pub(crate) const PHOTO_COLUMNS: &str =
    "path, name, date_taken, width, height, is_favorite, content_hash, \
     latitude, longitude, location_name, \
     camera_make, camera_model, lens_model, iso, aperture, shutter_us, \
     focal_length_mm, orientation, duration_ms, codec, thumb_status";

/// Map a row produced by PHOTO_COLUMNS into a PhotoMetadata.
pub(crate) fn photo_from_row(row: &rusqlite::Row) -> rusqlite::Result<PhotoMetadata> {
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
