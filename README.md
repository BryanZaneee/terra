# Terra - Local Photo Gallery

<div align="center">

**High-performance local photo gallery for macOS with a unique "Glassy + Dither + ASCII" aesthetic**

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)

</div>

## Overview

Terra is a blazingly fast local photo gallery application built for macOS, capable of browsing massive libraries (10k+ images) with stunning performance. It features a unique visual aesthetic combining glassy UI elements, dithered backgrounds, and ASCII flow effects.

### Key Features

- **🚀 High Performance**: Handles 10,000+ images with parallel processing (Rust + Rayon)
- **📁 Local-First**: No cloud dependencies for viewing your photos
- **🎨 Unique Aesthetic**: Glassy UI with animated ASCII dithered background
- **📊 Smart Organization**: Sort by years, months, or view all photos
- **🔍 EXIF Support**: Automatically extracts photo metadata and dates
- **☁️ Cloud Migration Ready**: UI placeholders for future iCloud/Google Photos integration

## Architecture

### Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Rust (Tauri v2)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Performance**: Rayon (parallel processing), WalkDir (recursive scanning)
- **Metadata**: kamadak-exif (EXIF extraction)

### Three-Tier Performance Pipeline

1. **Tier A (Rust)**: Parallel filesystem scanning with `rayon` and `walkdir`
2. **Tier B (Future)**: SQLite caching for instant startup
3. **Tier C (React)**: Virtualized rendering for smooth scrolling

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **Rust** (latest stable version)
- **macOS** 10.15 or higher

### Installing Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Installing Node.js

```bash
# Using Homebrew
brew install node
```

## Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/terra.git
cd terra
```

2. **Install dependencies**

```bash
npm install
```

3. **Run the development server**

```bash
npm run tauri:dev
```

The first build will take a few minutes as Rust compiles all dependencies.

## Usage

### Scanning a Directory

1. Launch the application
2. Enter a directory path in the input field (e.g., `/Users/YourName/Pictures`)
3. Click the **Scan** button
4. Terra will recursively scan the directory and display all images

### View Modes

- **All Photos**: View all photos in a single grid
- **Years**: Group photos by year
- **Months**: Group photos by month and year

### Viewing Photos

- Click any photo thumbnail to open it in full-screen modal
- Press the **X** button or click outside to close the modal
- Hover over thumbnails to see filename and date

## Project Structure

```
terra/
├── src/                    # React frontend
│   ├── App.jsx            # Main application component
│   ├── main.jsx           # React entry point
│   └── index.css          # Global styles with Tailwind
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs         # Core library with scan_directory command
│   │   └── main.rs        # Desktop entry point
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── index.html             # HTML entry point
├── vite.config.js         # Vite configuration
├── tailwind.config.js     # Tailwind CSS configuration
└── package.json           # Node.js dependencies and scripts
```

## Building for Production

```bash
npm run tauri:build
```

This will create a macOS `.app` bundle in `src-tauri/target/release/bundle/`.

## Development

### Available Scripts

- `npm run dev` - Start Vite development server only
- `npm run tauri:dev` - Start full Tauri development environment
- `npm run build` - Build frontend for production
- `npm run tauri:build` - Build complete application bundle

### Adding New Features

The application is designed to be extensible:

1. **Backend Commands**: Add new Rust commands in `src-tauri/src/lib.rs`
2. **Frontend Components**: Create new React components in `src/`
3. **Styling**: Extend Tailwind configuration in `tailwind.config.js`

## Performance Optimization

Terra is built for performance:

- **Parallel Processing**: Uses all CPU cores via Rayon
- **Lazy Loading**: Images load only when visible
- **Efficient EXIF Reading**: Streams file data without loading entire images
- **Future**: Virtual scrolling for 50,000+ image libraries

## Roadmap

- [ ] SQLite caching for instant startup
- [ ] Virtual scrolling (react-window integration)
- [ ] iCloud Photos integration
- [ ] Google Photos integration
- [ ] Search and filtering
- [ ] Favorites and collections
- [ ] Face detection and grouping
- [ ] Video support
- [ ] Photo editing capabilities

## Known Issues

- First scan can be slow on very large directories (10,000+ images)
- HEIC format support depends on system image libraries
- Some EXIF formats may not parse correctly

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- UI icons from [Lucide](https://lucide.dev/)
- Inspired by modern photo management applications with a unique aesthetic twist

---

<div align="center">

**Built with ❤️ using Rust and React**

</div>
