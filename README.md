# reMarkable Bridge

[![Downloads](https://img.shields.io/github/downloads/kebl3541/obsidian-remarkable-bridge/total?style=flat&logo=github&label=Downloads&color=success&cacheSeconds=3600)](https://github.com/kebl3541/obsidian-remarkable-bridge/releases)
[![GitHub stars](https://img.shields.io/github/stars/kebl3541/obsidian-remarkable-bridge?style=flat&logo=github&label=Stars&cacheSeconds=300)](https://github.com/kebl3541/obsidian-remarkable-bridge/stargazers)
[![Latest release](https://img.shields.io/github/v/release/kebl3541/obsidian-remarkable-bridge?style=flat&label=Release&cacheSeconds=3600)](https://github.com/kebl3541/obsidian-remarkable-bridge/releases/latest)

Write in Obsidian, edit on paper. Send a note to your reMarkable, type on it
with the Type Folio — footnotes included — and pull the edits back as clean
markdown. Send a PDF, mark it up with the pen, and pull it back with your ink
baked onto the pages and every text highlight extracted. No Connect
subscription, no cloud hacking: the official desktop app does all the syncing.

<p align="center">If this plugin adds value for you and you would like to help support
continued development, please use the buttons below:</p>

<p align="center">
<a href="https://www.paypal.com/donate/?business=berlin.philosophy%40gmail.com&no_recurring=0&currency_code=EUR"><img src="https://www.paypalobjects.com/webstatic/mktg/Logo/pp-logo-200px.png" alt="PayPal" height="42"></a>
&nbsp;&nbsp;
<a href="https://buymeacoffee.com/philosophizer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="52"></a>
</p>

<p align="center"><strong><a href="https://buymeacoffee.com/philosophizer">☕ Buy me a coffee</a></strong>&nbsp;&nbsp;·&nbsp;&nbsp;<strong><a href="https://www.paypal.com/donate/?business=berlin.philosophy%40gmail.com&no_recurring=0&currency_code=EUR">💙 Donate via PayPal</a></strong></p>

<p align="center">If you like this plugin or find it useful, please consider giving it a <a href="https://github.com/kebl3541/obsidian-remarkable-bridge">star</a> <a href="https://github.com/kebl3541/obsidian-remarkable-bridge"><img src="https://img.shields.io/github/stars/kebl3541/obsidian-remarkable-bridge?style=social&cacheSeconds=300" alt="GitHub Repo stars"></a> on GitHub!</p>

This is an unofficial project. It is not affiliated with or endorsed by reMarkable AS.

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

## Features

- **One ribbon button, two choices**: click the tablet icon for "Import from reMarkable…" or "Export to reMarkable…"; each opens a searchable picker. No persistent panels.
- **Notes round-trip as text**: headings, bold, italic, bullets, and footnotes survive both directions. Fenced code blocks are stashed on send and restored on pull.
- **Footnotes on the device**: existing footnotes appear as frozen `[n]` markers with an editable Notes section; new footnotes are typed inline as `((the note text))` and come back properly numbered. Full guide in [docs/FOOTNOTES.md](docs/FOOTNOTES.md).
- **PDFs both ways**: send a vault PDF for reading and annotation; pull back a `(annotated).pdf` with your ink rendered onto the pages (calibrated pen colors, opacity, and pressure-varying width) plus a highlights note with every text highlight organized by page.
- **Import anything**: any typed-text notebook or PDF on the device can be imported into the vault, no check-out needed.
- **Check-out model**: a sent note shows a banner and (optionally) refuses edits in Obsidian until pulled back, so the two copies cannot diverge. Out-of-band edits (sync plugins, git) are detected and diverted to a conflict copy instead of overwritten.
- **Watcher**: the plugin notices device edits arriving on your computer and offers to pull, or pulls automatically if auto-pull is enabled. Status bar shows `rM: 2 out, 1 ready`.
- **Safety**: never deletes device data (archiving means the device trash), keeps device copies that contain handwriting or conflicts, and refuses to write if the store layout looks unfamiliar.

## Design

Check-out/check-in, to avoid merge conflicts:

1. **Export to reMarkable**: the note's markdown becomes a typed-text notebook in the store; the vault note is marked checked out.
2. Edit on the device with the Type Folio (or pen, for PDFs).
3. **Import / pull back**: the plugin reads the document, converts it to markdown (or bakes ink into a PDF copy), and restores it. The device copy is archived to stay under the free tier's document sync limit.

The `.rm` v6 text codec is a TypeScript port of [rmscene](https://github.com/ricklupton/rmscene)'s logic, cross-checked against it on hundreds of real pages; pen rendering calibration follows [reMarkable Sync](https://github.com/TimDommett/Remarkable-Sync---Obsidian-Plugin). The original Python validation spikes live in `spike/`.

## Filesystem access and privacy

Obsidian's review tooling correctly flags this plugin for direct filesystem
access, so here is exactly what it touches:

- **Outside the vault, it reads and writes one directory only**: the reMarkable
  desktop app's local document store (on macOS
  `~/Library/Containers/com.remarkable.desktop/…/remarkable/desktop/`, or the
  path you set in settings). All access goes through one module rooted at that
  directory.
- **What it does there**: reads documents, creates new documents, and edits a
  document's metadata to move it to the device trash. It never hard-deletes
  anything, never rewrites an existing page file, and refuses to write at all
  if the directory layout doesn't look like a reMarkable store.
- **Inside the vault** it uses only Obsidian's own vault API.
- **Vault enumeration**: the plugin lists the vault's files in exactly one
  place — when you open the "Export to reMarkable…" picker, to show you your
  notes and PDFs to choose from. The list is built in memory for that picker
  and discarded when it closes. Nothing about your vault's structure is
  stored, indexed in the background, or written anywhere.
- **Network**: the plugin makes no network requests of any kind. Syncing with
  the tablet is done entirely by the official reMarkable app. Nothing leaves
  your machine because of this plugin.

`isDesktopOnly` is set accordingly; the plugin cannot run on mobile.

## Caveats

- The desktop app's storage layout is undocumented and could change in an app update. The plugin must detect unknown layouts and refuse to write rather than guess.
- Editing the same document on both sides between syncs will fork or clobber; the check-out model exists to prevent this.

## Support

If this plugin adds value for you and you would like to help support continued
development, please use the buttons below:

<a href="https://www.paypal.com/donate/?business=berlin.philosophy%40gmail.com&no_recurring=0&currency_code=EUR"><img src="https://www.paypalobjects.com/webstatic/mktg/Logo/pp-logo-200px.png" alt="PayPal" height="42"></a>
&nbsp;&nbsp;
<a href="https://buymeacoffee.com/philosophizer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="52"></a>

## License

GPL-3.0-or-later. Third-party attributions in [NOTICES.md](NOTICES.md).
