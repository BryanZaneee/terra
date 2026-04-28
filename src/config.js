export const CONFIG = {
  /** Target frames per second for background animation */
  ANIMATION_FPS: 24,
  /** Debounce delay in milliseconds for search input */
  SEARCH_DEBOUNCE_MS: 300,
  /** Duration in milliseconds to show status messages */
  STATUS_TIMEOUT_MS: 3000,
  /** Hamming distance threshold for duplicate detection (must match backend) */
  DUPLICATE_THRESHOLD: 10,
  /**
   * Toggle cursor-paginated photo loading (PAGINATION_PLAN.md).
   * Default off until the rollout reaches P.6 and the legacy `get_all_photos`
   * path is removed. Flip to `true` to dogfood without code changes.
   */
  USE_PAGINATION: false,
  /** Rows per page for `get_photos_page`. ~4 screens at 5-col layout. */
  PAGE_SIZE: 200,
};
