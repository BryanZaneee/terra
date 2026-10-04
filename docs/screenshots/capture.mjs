import { capture } from './capture-lib.mjs';
await capture({
  command: 'npm', args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '9424', '--strictPort'], port: 9424,
  async setup(context) {
    await context.addInitScript(() => {
      const photos = Array.from({ length: 24 }, (_, i) => ({ path: `/fixture/${i}.jpg`, name: `Study ${i + 1}.jpg`, date_taken: 1790985600 - i * 86400, width: 1200, height: 900, file_size: 2400000, is_favorite: i % 5 === 0, is_archived: false, is_reviewed: false }));
      window.__TAURI_INTERNALS__ = {
        convertFileSrc: p => {
          const i = Number(p.match(/(\d+)\.jpg/)?.[1] || 0);
          return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="hsl(${i * 23},25%,78%)"/><circle cx="390" cy="180" r="100" fill="hsl(${i * 23 + 30},45%,59%)"/><path d="M0 470L220 170 430 420 600 280V600H0Z" fill="hsl(${i * 23},25%,35%)"/></svg>`);
        },
        transformCallback: () => 1,
        invoke: async command => {
          if (command === 'get_photos_page') return { photos, next_cursor: null };
          if (command === 'get_view_counts') return { all: 24, photos: 24, videos: 0, favorites: 5, archived: 0 };
          if (command === 'get_library_path_command') return '/fixture/library';
          if (command === 'get_unreviewed_count') return 24;
          if (command === 'get_albums') return [{ id: 1, name: 'Color studies', photo_count: 24 }];
          if (command === 'get_smart_collections') return [{ id: 'recent', name: 'Recent imports', category: 'time', icon: 'calendar', count: 24 }];
          if (command === 'get_thumb_cache_root') return null;
          return [];
        }
      };
    });
  },
  async shots(page, origin, shoot) {
    await page.goto(origin); await page.getByAltText('Study 1.jpg', { exact: true }).waitFor(); await shoot('library-light');
    await page.getByRole('button', { name: /dark mode/i }).click(); await shoot('library-dark');
  }
});
