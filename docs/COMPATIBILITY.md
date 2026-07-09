# Compatibility notes

Audited 2026-07-09 against the 26 other plugins enabled in the author's vault, by scanning each for the three surfaces this plugin occupies and reasoning about overlap. Updated as issues are found.

## How this plugin touches shared machinery

1. **An editor transaction filter** that drops edits to checked-out notes (when "Lock notes while checked out" is on).
2. **A banner element** inserted as a sibling after `.view-header` in markdown views.
3. **Reads and writes of note files** via `vault.process` on pull, and a `remarkable-id` frontmatter key while checked out.
4. Ribbon icons, a status bar item, a right-sidebar view, file-menu entries. These are additive; Obsidian composes them without conflict.

It never patches Obsidian internals, never monkey-patches other plugins, and touches nothing outside the vault except the reMarkable desktop app's store (read plus new-file writes).

## Interactions worth knowing about

- **Sync and merge plugins (google-drive-merge-sync, remotely-save, obsidian-git):** these write files directly, which no editor lock can intercept. Safe by design: at send time the plugin fingerprints the note body, and if a pull finds the body changed underneath the checkout, the reMarkable version is written to a `... (from reMarkable).md` sibling instead of overwriting. Nothing is lost on either side; you merge by hand.
- **live-coedit:** remote collaborators' edits arrive as editor transactions, so on a checked-out note they are blocked like any other edit. Don't co-edit a note that is checked out to the device; the collaborator's session may desync for that note. Pull first, then collaborate.
- **dangerzone-writing:** its sessions type into the editor continuously; on a checked-out note every keystroke is blocked (one notice per 2 seconds, not a flood). Start dangerzone sessions only on notes that aren't checked out.
- **editing-toolbar / note-toolbar:** both decorate the view chrome. The banner inserts after the header rather than into it, so they stack; verified visually.
- **Footnote plugins (footnote-inline-editor, footnote-compass, proofreader, equation-citator):** the pull pipeline emits standard `[^n]` markers and definitions, renumbered sequentially, which is exactly the shape those plugins expect. The `((...))` syntax exists only on the device; it never reaches the vault.
- **tasknotes / longform / day-planner (frontmatter users):** the plugin adds a single namespaced `remarkable-id` key via `processFrontMatter` and removes it on pull. It never rewrites other keys.
- **PDF annotators (pdf-highlight-notes, PDF++):** pulls write a *new* `... (annotated).pdf` and a highlights note; the original PDF is never modified, so markdown-side annotations that reference it stay valid. Annotations embedded *inside* a PDF by other tools travel to the device on send and render there.

## Known limitations

- The editor lock is advisory for anything that isn't an editor: scripts, sync, git checkouts. The conflict copy is the safety net.
- Two plugins writing the same note at the same moment is an Obsidian-wide race no plugin can fully fix; `vault.process` (atomic read-modify-write) is used to keep this plugin's own writes safe.
