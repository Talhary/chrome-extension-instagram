# Instagram Video Downloader & Auto-Downloader Chrome Extension

A high-performance Manifest V3 Chrome extension that allows you to download Instagram Reels and videos directly from the interface, with advanced auto-downloading capabilities.

## Features

- **Direct Download Button**: Integrates a "Download" button directly into the Reels actions column (above the heart/like icon).
- **Auto-Download Watched Reels**: Turn this option ON in the settings to automatically download Reels as you scroll and watch them.
- **Configurable Watch Threshold**: Set how many seconds a Reel must play before it triggers an automatic download (prevents downloading skipped items).
- **Download Subfolders**: Save files into a custom subfolder (e.g. `Downloads/InstagramReels/`) automatically.
- **Smart Duplicate Prevention**: Maintains a local history of downloaded video shortcodes to avoid downloading the same Reel twice.
- **Instant React Fiber Walk**: Scrapes direct CDN URLs from React's internal component state in under **1 millisecond** without lagging or freezing the browser.

## Installation

1. Clone or download this repository to your local machine.
2. Open Google Chrome or Microsoft Edge and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (top-left) and select the directory containing this extension.

## Usage

- **Manual Download**: Simply click the **Download** button that appears above the Heart/Like icon on any Instagram Reel.
- **Auto-Download**: Click the Extension icon in your browser toolbar to open the settings panel, toggle **Auto-Download Reels** to ON, and configure your watch threshold and destination subfolder.

---
Created by Antigravity.
