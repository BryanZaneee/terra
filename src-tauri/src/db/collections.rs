/// Static smart-collection metadata. Counts come from
/// `get_view_counts().by_smart_collection` and the WHERE clauses live in
/// `pagination::smart_collection_filter_sql` — this table is the single
/// source of ids/names shown in the sidebar.
#[derive(serde::Serialize, Clone, Copy)]
pub struct SmartCollection {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    pub category: &'static str,
}

pub const SMART_COLLECTIONS: &[SmartCollection] = &[
    SmartCollection { id: "size_large", name: "Large (>5MB)", icon: "hard-drive", category: "size" },
    SmartCollection { id: "size_medium", name: "Medium (1-5MB)", icon: "hard-drive", category: "size" },
    SmartCollection { id: "size_small", name: "Small (<1MB)", icon: "hard-drive", category: "size" },
    SmartCollection { id: "dim_4k", name: "4K+", icon: "monitor", category: "dimension" },
    SmartCollection { id: "dim_hd", name: "HD", icon: "monitor", category: "dimension" },
    SmartCollection { id: "dim_portrait", name: "Portrait", icon: "smartphone", category: "dimension" },
    SmartCollection { id: "dim_landscape", name: "Landscape", icon: "monitor", category: "dimension" },
    SmartCollection { id: "time_7days", name: "Last 7 Days", icon: "calendar", category: "time" },
    SmartCollection { id: "time_30days", name: "Last 30 Days", icon: "calendar", category: "time" },
    SmartCollection { id: "time_year", name: "This Year", icon: "calendar", category: "time" },
    SmartCollection { id: "status_unreviewed", name: "Unreviewed", icon: "eye-off", category: "status" },
];
