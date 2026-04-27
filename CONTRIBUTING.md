# Contributing to Terra

Thank you for contributing to Terra. The app is a local-first macOS photo and video manager built with React, Tauri, Rust, and SQLite.

## Development Setup

### Prerequisites

- Node.js 18 or newer
- Rust stable toolchain
- macOS 10.15 or newer

### Getting Started

```bash
git clone https://github.com/BryanZaneee/terra.git
cd terra
npm install
npm run tauri:dev
```

The first Tauri build can take a few minutes while Rust dependencies compile.

### Building

```bash
npm run build
npm run tauri:build
```

The desktop bundle is generated under `src-tauri/target/release/bundle/`.

## Code Style

### Rust

- Follow standard Rust formatting with `cargo fmt`.
- Use `cargo clippy` for common mistakes when working on backend logic.
- Use structured logging macros (`debug!`, `info!`, `warn!`, `error!`) instead of `println!`.
- Put shared constants in the `config` module in `src-tauri/src/lib.rs`.
- Keep SQLite schema and query changes in `src-tauri/src/db.rs`.
- Register new Tauri commands in the `invoke_handler` in `src-tauri/src/lib.rs`.

### JavaScript and React

- Use functional components and hooks.
- Keep shared app state in `src/contexts/` or focused hooks in `src/hooks/`.
- Keep reusable UI in `src/components/`.
- Use `src/config.js` for frontend constants that are shared across components.
- Use `console.error` for recoverable UI-side failures; avoid stray debug logging.

## Project Structure

```text
terra/
├── src/                    # React frontend
│   ├── components/         # Gallery, sidebar, modals, review and analytics UI
│   ├── contexts/           # App, view, and selection providers
│   ├── hooks/              # Photo, album, tag, cleanup, and selection state
│   ├── utils/              # Frontend helpers
│   ├── App.jsx             # Main application composition
│   └── main.jsx            # React entry point
├── src-tauri/              # Rust/Tauri backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands and media processing
│   │   ├── db.rs           # SQLite schema and queries
│   │   └── main.rs         # Desktop entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── ROADMAP.md
└── package.json
```

## Making Changes

1. Keep changes focused on one feature or fix.
2. Update docs when behavior, setup, architecture, or workflows change.
3. Add or update tests for new behavior when practical.
4. Avoid changing existing user data schemas without a migration path.
5. Do not remove safety checks around filesystem deletion or archive handling.
6. Do not widen the Tauri asset protocol scope in `src-tauri/tauri.conf.json`
   beyond `$PICTURE/**` and `$DATA/**` without a security review. Those two
   scopes already cover the managed library (`~/Pictures/Terra`) and the
   SQLite database location (`~/Library/Application Support/terra`).

## Adding a Tauri Command

1. Add the Rust command in `src-tauri/src/lib.rs`:

   ```rust
   #[tauri::command]
   fn my_command(param: String) -> Result<String, String> {
       Ok(param)
   }
   ```

2. Register it in the generated handler:

   ```rust
   .invoke_handler(tauri::generate_handler![
       my_command
   ])
   ```

3. Call it from React:

   ```javascript
   const result = await invoke('my_command', { param: 'value' });
   ```

## Modifying the Database Schema

- Update schema creation in `src-tauri/src/db.rs`.
- Use lightweight migrations with `ALTER TABLE ADD COLUMN` for existing databases.
- Keep query result column order aligned with row-mapping helpers.
- Add indexes for frequently queried metadata.
- Update Rust structs and frontend processing helpers when returned fields change.

## Verification

For documentation-only changes:

```bash
git diff --check
```

For frontend changes:

```bash
npm run test:run
npm run build
```

For Rust/backend changes:

```bash
cd src-tauri
cargo test
cargo check
```

For full desktop smoke testing:

```bash
npm run tauri:dev
```

## Roadmap

See `docs/ROADMAP.md` for the next planned work around thumbnails, virtualization, import jobs, and cloud/social archive imports.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
