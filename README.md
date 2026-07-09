# Obsidian reMarkable Bridge

An Obsidian plugin for sending notes to a reMarkable Paper Pro, editing them there as typed text with the Type Folio keyboard, and pulling the edited text back into the vault.

This is an unofficial project. It is not affiliated with or endorsed by reMarkable AS. It requires no Connect subscription.

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

## Planned design

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
