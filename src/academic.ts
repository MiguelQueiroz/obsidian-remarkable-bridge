/*
 * Markdown ↔ reMarkable typed text translation.
 *
 * Send: markdown becomes device paragraphs; footnote definitions move to a
 * visible Notes section with frozen [n] markers; fenced code blocks are
 * stashed and replaced by placeholders.
 *
 * Pull: markers and Notes entries are matched back up, ((...)) inline
 * footnotes become new definitions, everything is renumbered in order of
 * appearance, and stashed blocks are restored.
 */

import { OutParagraph, ParagraphStyle, ParsedParagraph } from "./rm/codec";

export const NOTES_HEADING = "⸻ Notes ⸻";
const STASH_MARKER = (n: number) => `⟦stash ${n}⟧`;
const STASH_RE = /⟦stash (\d+)⟧/g;
export const CHEAT_MARKER = "⸻ Syntax cheat sheet (not copied back) ⸻";

export interface SendResult {
  paragraphs: OutParagraph[];
  stash: string[];
}

export interface PullResult {
  markdown: string;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Inline markdown spans                                               */
/* ------------------------------------------------------------------ */

function inlineToSpans(text: string): OutParagraph["spans"] {
  const spans: OutParagraph["spans"] = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf) spans.push({ text: buf, bold, italic });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      flush();
      bold = !bold;
      i += 2;
    } else if (text[i] === "*" || (text[i] === "_" && (i === 0 || /[\s(]/.test(text[i - 1]) || italic))) {
      flush();
      italic = !italic;
      i += 1;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  flush();
  return spans;
}

function spansToInline(spans: ParsedParagraph["spans"]): string {
  return spans
    .map((s) => {
      let t = s.text;
      if (s.italic) t = `*${t}*`;
      if (s.bold) t = `**${t}**`;
      return t;
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Send: markdown -> device paragraphs                                 */
/* ------------------------------------------------------------------ */

export function markdownToDevice(body: string, appendCheatSheet = false): SendResult {
  const stash: string[] = [];
  let text = body.replace(/^```[\s\S]*?^```[ \t]*$/gm, (block) => {
    stash.push(block);
    return STASH_MARKER(stash.length - 1);
  });

  // Collect footnote definitions and drop them from the body.
  const defs = new Map<string, string>();
  text = text.replace(/^\[\^([^\]]+)\]:[ \t]?(.*(?:\n(?:[ \t]+.*|$))*)/gm, (_m, key: string, def: string) => {
    defs.set(key, def.replace(/\n[ \t]+/g, " ").trim());
    return "";
  });

  // Number references in order of appearance; freeze as [n].
  const order: string[] = [];
  text = text.replace(/\[\^([^\]]+)\]/g, (_m, key: string) => {
    let n = order.indexOf(key);
    if (n === -1) {
      order.push(key);
      n = order.length - 1;
    }
    return `[${n + 1}]`;
  });

  const paragraphs: OutParagraph[] = [];
  const lines = text.replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
  for (const line of lines) {
    let style: number = ParagraphStyle.PLAIN;
    let rest = line;
    const heading = line.match(/^(#{1,6})[ \t]+(.*)$/);
    const bullet = line.match(/^[ \t]*[-*][ \t]+(.*)$/);
    if (heading) {
      // The device has one heading level; deeper levels become bold lines.
      style = heading[1].length === 1 ? ParagraphStyle.HEADING : ParagraphStyle.BOLD;
      rest = heading[2];
    } else if (bullet && !line.match(/^[ \t]*[-*][ \t]*$/)) {
      style = ParagraphStyle.BULLET;
      rest = bullet[1];
    }
    paragraphs.push({ style: style as OutParagraph["style"], spans: inlineToSpans(rest) });
  }

  if (order.length || defs.size) {
    paragraphs.push({ style: ParagraphStyle.PLAIN, spans: [] });
    paragraphs.push({ style: ParagraphStyle.BOLD, spans: [{ text: NOTES_HEADING }] });
    order.forEach((key, i) => {
      const def = defs.get(key) ?? "";
      if (!defs.has(key)) {
        // Keep going; the pull side will warn about it too.
      }
      defs.delete(key);
      paragraphs.push({ style: ParagraphStyle.PLAIN, spans: inlineToSpans(`[${i + 1}] ${def}`) });
    });
    for (const [key, def] of defs) {
      paragraphs.push({ style: ParagraphStyle.PLAIN, spans: inlineToSpans(`[unused: ${key}] ${def}`) });
    }
  }

  if (appendCheatSheet) {
    paragraphs.push({ style: ParagraphStyle.PLAIN, spans: [] });
    paragraphs.push({ style: ParagraphStyle.BOLD, spans: [{ text: CHEAT_MARKER }] });
    for (const line of [
      "New footnote: ((text of the note))",
      "Edit a footnote: change its [n] line under Notes",
      "Comment to self: %%like this%%",
      "Quote: start the line with >",
      "Citation: [@Key2002, 214]",
      "Bold, italics, headings: use the device formatting bar",
    ]) {
      paragraphs.push({ style: ParagraphStyle.BULLET, spans: [{ text: line }] });
    }
  }

  return { paragraphs, stash };
}

/* ------------------------------------------------------------------ */
/* Pull: device paragraphs -> markdown                                 */
/* ------------------------------------------------------------------ */

export function deviceToMarkdown(paragraphs: ParsedParagraph[], stash: string[]): PullResult {
  const warnings: string[] = [];

  const lines: { style: number; text: string }[] = paragraphs.map((p) => ({
    style: p.style,
    text: spansToInline(p.spans),
  }));

  // Split off the Notes section and the cheat sheet.
  let notesStart = -1;
  let cheatStart = -1;
  lines.forEach((l, i) => {
    const plain = l.text.replace(/\*/g, "").trim();
    if (notesStart === -1 && plain === NOTES_HEADING) notesStart = i;
    if (cheatStart === -1 && plain === CHEAT_MARKER) cheatStart = i;
  });
  const bodyEnd = Math.min(notesStart === -1 ? lines.length : notesStart, cheatStart === -1 ? lines.length : cheatStart);
  const noteLines = notesStart === -1 ? [] : lines.slice(notesStart + 1, cheatStart === -1 || cheatStart < notesStart ? undefined : cheatStart);

  const defs = new Map<string, string>();
  for (const l of noteLines) {
    const m = l.text.match(/^\s*\[(?:unused: )?([^\]]+)\]\s*(.*)$/);
    if (m) defs.set(m[1], m[2].trim());
    else if (l.text.trim()) {
      // Continuation of the previous note.
      const lastKey = [...defs.keys()].pop();
      if (lastKey) defs.set(lastKey, `${defs.get(lastKey)} ${l.text.trim()}`.trim());
      else warnings.push(`Ignored stray line in Notes section: "${l.text.trim()}"`);
    }
  }

  // Rebuild the body, collecting footnotes in order of appearance.
  const usedMarkers: string[] = [];
  const newDefs: string[] = [];
  const takeFootnotes = (text: string): string =>
    text
      .replace(/\(\(([\s\S]+?)\)\)/g, (_m, def: string) => {
        newDefs.push(def.trim());
        return `\uE000${newDefs.length - 1}\uE001`;
      })
      .replace(/\[(\d+)\]/g, (m, n: string) => {
        if (!defs.has(n)) {
          warnings.push(`Marker [${n}] has no entry in the Notes section; left as literal text.`);
          return m;
        }
        usedMarkers.push(n);
        return `\uE002${n}\uE003`;
      });

  const bodyLines: string[] = [];
  for (let i = 0; i < bodyEnd; i++) {
    const l = lines[i];
    let text = takeFootnotes(l.text);
    if (l.style === ParagraphStyle.HEADING) text = `# ${text}`;
    else if (l.style === ParagraphStyle.BOLD) text = `## ${text}`;
    else if (l.style === ParagraphStyle.BULLET || l.style === ParagraphStyle.BULLET2) text = `- ${text}`;
    else if (l.style === ParagraphStyle.CHECKBOX) text = `- [ ] ${text}`;
    else if (l.style === ParagraphStyle.CHECKBOX_CHECKED) text = `- [x] ${text}`;
    bodyLines.push(text);
  }
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();

  // Assign final numbers in order of appearance in the rebuilt body.
  let body = bodyLines.join("\n");
  const finalDefs: string[] = [];
  body = body.replace(/\uE000(\d+)\uE001|\uE002(\d+)\uE003/g, (_m, newIdx?: string, oldKey?: string) => {
    const def = newIdx !== undefined ? newDefs[parseInt(newIdx, 10)] : defs.get(oldKey!) ?? "";
    finalDefs.push(def);
    return `[^${finalDefs.length}]`;
  });

  for (const [key, def] of defs) {
    if (!usedMarkers.includes(key)) {
      warnings.push(`Notes entry [${key}] has no marker in the text; appended as an unreferenced footnote.`);
      finalDefs.push(def);
    }
  }

  if (finalDefs.length) {
    const numbered = finalDefs.map((def, i) => `[^${i + 1}]: ${def}`).join("\n");
    body = `${body}\n\n${numbered}`;
  }

  body = body.replace(STASH_RE, (m, n: string) => {
    const idx = parseInt(n, 10);
    if (idx >= stash.length) {
      warnings.push(`Placeholder ${m} has no stashed block; removed.`);
      return "";
    }
    return stash[idx];
  });

  return { markdown: body.trimEnd() + "\n", warnings };
}
