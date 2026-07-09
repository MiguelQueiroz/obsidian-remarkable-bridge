# Obsidian reMarkable Bridge

An Obsidian plugin for sending notes to a reMarkable Paper Pro, editing them there as typed text with the Type Folio keyboard, and pulling the edited text back into the vault. PDFs travel too: send them for reading, pull them back with your ink baked in and text highlights extracted.

This is an unofficial project. It is not affiliated with or endorsed by reMarkable AS. It requires no Connect subscription and never talks to reMarkable's cloud: the official desktop app does all the syncing.

## Status

Beta. Developed and tested on macOS with a reMarkable Paper Pro and the official reMarkable desktop app (free tier). The Windows and Linux store paths are untested guesses; set the store path manually in settings on those platforms and treat them as experimental. The plugin never deletes device data (archiving means the device trash) and refuses to write if the store layout looks unfamiliar, but this is beta software that touches your documents: keep backups of your vault.

## Install

Not yet in the community plugin directory. Manual install:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release (or build with `npm install && npm run build`).
2. Copy them to `<your vault>/.obsidian/plugins/remarkable-bridge/`.
3. Enable "reMarkable Bridge" in Settings → Community plugins.
4. Make sure the reMarkable desktop app is installed, paired, and has synced at least once.

## How it works

The reMarkable desktop app (free tier) keeps a full local copy of the tablet's document library on disk, in the tablet's own storage format:

```
~/Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop/
```

Each document is a UUID with sidecar files (`.metadata`, `.content`, `.local`, `.pagedata`) and a folder of per-page `.rm` v6 binary files. Typed text lives inside the `.rm` files as structured text blocks (a CRDT sequence), not as ink.

The plugin never talks to reMarkable's cloud. It reads and writes documents in this local store, and the official desktop app handles all syncing with the tablet. This avoids the unofficial cloud API entirely, along with its data loss history.

## Validated so far (2026-07-09)

- Reading typed text out of real notebooks in the store works (via [rmscene](https://github.com/ricklupton/rmscene)).
- Generating a typed-text notebook from scratch and injecting it into the store works. The desktop app accepts it, shows it, and syncs it to the Paper Pro.
- Editing the injected document on the tablet works.
- Text typed on the tablet with the Type Folio syncs back and extracts correctly. The full round trip is confirmed.
- Note: Paper Pro firmware writes some block types newer than rmscene fully supports (it warns but still extracts text). Any rewrite of an existing page must preserve unknown blocks byte for byte.

## Features

- **Send / pull / force-release**: command palette, right-click menu, ribbon button (context-aware: sends a free note, pulls a checked-out one), or the dashboard.
- **Dashboard** (right sidebar): checked-out notes with pull buttons, plus a browser of every document on the device with one-click import of its typed text into the vault.
- **Import**: "Import a reMarkable note into the vault" turns any typed-text document from the device into a new note, no check-out needed. Notes drafted spontaneously on the tablet flow into Obsidian.
- **Check-out banner and lock**: a checked-out note shows a banner and refuses edits in Obsidian until pulled back (toggleable).
- **Watcher**: the plugin sees device edits arrive on the Mac and offers to pull, or pulls automatically if auto-pull is enabled.
- **Status bar**: `rM: 2 out, 1 ready` at a glance; click to open the dashboard.
- **Footnote workflow**: see [docs/FOOTNOTES.md](docs/FOOTNOTES.md).
- **Safety**: never deletes device data (archiving means the device trash), keeps device copies that contain handwriting, and refuses to write if the store layout looks unfamiliar.

## Design

Check-out/check-in model, to avoid merge conflicts:

1. **Send to reMarkable**: a command converts the current note's markdown to a typed-text notebook and writes it into the store. The note is marked checked out in Obsidian.
2. Edit on the device with the Type Folio (or on any synced device).
3. **Pull from reMarkable**: the plugin reads the notebook back, extracts the text, and restores it into the note. The device copy is then archived to stay under the free tier's document sync limit.

Headings, bold, italic, and bullets survive the round trip. Code blocks, links, and footnotes will need to be stashed and re-attached on return.

## Repository layout

- `spike/`: Python proof-of-concept scripts using `rmscene` (run in a venv with `pip install rmscene`). These validated the architecture and will serve as the reference for a TypeScript port, since Obsidian plugins run in JavaScript.

## Caveats

- The desktop app's storage layout is undocumented and could change in an app update. The plugin must detect unknown layouts and refuse to write rather than guess.
- Editing the same document on both sides between syncs will fork or clobber; the check-out model exists to prevent this.
