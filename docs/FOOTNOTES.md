# Writing footnotes on the reMarkable

The reMarkable's editor has no footnote button and never will; its software is closed. What it does have is your Type Folio keyboard, and everything you type is plain text that this plugin translates on the way in and the way out. Footnotes therefore work by syntax, not by toolbar. There are exactly two things to learn.

## 1. Editing footnotes that came with the note

When you send a note to the reMarkable, its footnotes travel with it. In Obsidian your note looks like this:

```markdown
Aristotle treats technē as an organon of reason.[^1] The empeiria
contrast makes this vivid.[^2]

[^1]: Pace Broadie, who reads the Z.7 passage differently.
[^2]: Metaphysics A.1, 981a1-12.
```

On the reMarkable it appears like this:

```text
Aristotle treats technē as an organon of reason.[1] The empeiria
contrast makes this vivid.[2]

⸻ Notes ⸻
[1] Pace Broadie, who reads the Z.7 passage differently.
[2] Metaphysics A.1, 981a1-12.
```

To edit a footnote on the device, scroll to the Notes section at the bottom and edit its text like any other line. To delete one, delete both the marker `[1]` in the body and its line in the Notes section (if you forget one half, the plugin flags it on pull instead of guessing).

## 2. Adding a new footnote on the device

Type it inline, right where your cursor is, wrapped in double parentheses:

```text
The genealogy section should open with the empeiria contrast
((Contra Lorenz 2009, who starts from epistēmē.)) and only then
introduce the organon claim.
```

Don't think about numbering. When you pull the note back into Obsidian, the plugin extracts every `((...))`, converts it to a proper markdown footnote at that exact spot, renumbers the whole note, and files the definition at the bottom:

```markdown
The genealogy section should open with the empeiria contrast[^2]
and only then introduce the organon claim.

[^2]: Contra Lorenz 2009, who starts from epistēmē.
```

A `((...))` can contain italics, citations, anything a footnote can contain. It just can't contain another `((...))`.

## Rules of the road

- Numbering on the device is frozen at send time. New `((...))` footnotes don't get numbers until pull. This is deliberate: renumbering live on the device is impossible, so the plugin does it once, on return.
- Never renumber markers by hand on the device. Move a marker like `[2]` around freely (cut and paste it with its brackets), but let the plugin fix the ordering afterwards.
- A marker without a Notes entry, or a Notes entry without a marker, is reported as a warning on pull, with the note text preserved so nothing is lost.
- Avoid writing literal bracketed numbers like `[2]` as ordinary prose in a note that has footnotes: on pull, a bracketed number that matches an existing footnote is treated as that footnote's marker. Use `(2)` or `no. 2` instead.

## The rest of the academic toolkit

These all work on the device today, alongside footnotes:

| You want | On the reMarkable | Back in Obsidian |
|---|---|---|
| Italics / bold | The device's own formatting bar (select text, tap B or I) | `*italics*`, `**bold**` |
| Headings | The device's paragraph styles | `#`, `##`, `###` |
| A citation | Type the pandoc key: `[@Broadie2002, 214]` | Unchanged; validated against your bibliography on pull |
| A note to self | `%%rewrite this transition%%` | An Obsidian comment, invisible in exports |
| A block quote | Start the line with `> ` | A markdown block quote |
| A new footnote | `((The note text.))` | A numbered `[^n]` footnote |

Not supported on the device: tables (they survive as plain pipe-text but don't render), images, live footnote numbers, tracked changes. Those are Obsidian's job when the note comes home.

## Cheat sheet on the device

Until this is muscle memory, the plugin can append a one-page syntax reference as the last page of every document it sends (Settings → "Append cheat sheet"). Delete the page on the device any time; the plugin never copies it back.
