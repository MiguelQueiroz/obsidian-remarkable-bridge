/*
 * Reader/writer for the text layer of reMarkable .rm v6 files.
 *
 * Ported from rmscene (MIT, Rick Lupton) with the same tolerance rules:
 * unknown blocks and trailing bytes inside known blocks are preserved as
 * opaque data, never guessed at. The writer only produces fresh documents;
 * existing pages are never rewritten in place.
 */

export const HEADER_V6 = "reMarkable .lines file, version=6          ";

export const TagType = {
  ID: 0xf,
  Length4: 0xc,
  Byte8: 0x8,
  Byte4: 0x4,
  Byte1: 0x1,
} as const;

export const ParagraphStyle = {
  BASIC: 0,
  PLAIN: 1,
  HEADING: 2,
  BOLD: 3,          // bare code 3 = smallest heading (H3) on current firmware
  BULLET: 4,
  BULLET2: 5,
  CHECKBOX: 6,
  CHECKBOX_CHECKED: 7,
  NUMBERED: 10,
  // Internal pseudo-code: firmware encodes the MIDDLE heading (H2) as code 3
  // plus extended fields (0x21 Byte1 = 2 [level], 0x34 Byte4 = 3).
  // Never written to disk as a raw byte — see reader/writer special-casing.
  HEADING2: 300,
} as const;


export interface CrdtId {
  part1: number;
  part2: number;
}

const id = (part1: number, part2: number): CrdtId => ({ part1, part2 });
const idEq = (a: CrdtId, b: CrdtId) => a.part1 === b.part1 && a.part2 === b.part2;
const idKey = (a: CrdtId) => `${a.part1}:${a.part2}`;
export const END_MARKER: CrdtId = id(0, 0);

export const ParagraphStyle = {
  BASIC: 0,
  PLAIN: 1,
  HEADING: 2,
  BOLD: 3,
  BULLET: 4,
  BULLET2: 5,
  CHECKBOX: 6,
  CHECKBOX_CHECKED: 7,
} as const;
export type ParagraphStyleValue = (typeof ParagraphStyle)[keyof typeof ParagraphStyle];

export interface TextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface ParsedParagraph {
  style: ParagraphStyleValue;
  spans: TextSpan[];
}

export interface ParsedPage {
  paragraphs: ParsedParagraph[];
  hasStrokes: boolean;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Byte streams                                                        */
/* ------------------------------------------------------------------ */

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get length() {
    return this.buf.length;
  }
  eof() {
    return this.pos >= this.buf.length;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error("EOF");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8(): number {
    if (this.pos >= this.buf.length) throw new Error("EOF");
    return this.buf[this.pos++];
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  varuint(): number {
    let shift = 0;
    let result = 0;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    return result;
  }
  crdtId(): CrdtId {
    return id(this.u8(), this.varuint());
  }
  peekTag(): { index: number; tagType: number } | null {
    const start = this.pos;
    try {
      const x = this.varuint();
      return { index: x >> 4, tagType: x & 0xf };
    } catch {
      return null;
    } finally {
      this.pos = start;
    }
  }
  tag(expectedIndex: number, expectedType: number): void {
    const start = this.pos;
    const x = this.varuint();
    const index = x >> 4;
    const tagType = x & 0xf;
    if (index !== expectedIndex || tagType !== expectedType) {
      this.pos = start;
      throw new Error(
        `Expected tag ${expectedIndex}/0x${expectedType.toString(16)}, got ${index}/0x${tagType.toString(16)} at ${start}`
      );
    }
  }
  checkTag(expectedIndex: number, expectedType: number): boolean {
    const t = this.peekTag();
    return t !== null && t.index === expectedIndex && t.tagType === expectedType;
  }
}

class Writer {
  private chunks: number[] = [];
  bytes(b: Uint8Array | number[]) {
    for (const x of b) this.chunks.push(x);
  }
  u8(v: number) {
    this.chunks.push(v & 0xff);
  }
  u16(v: number) {
    this.chunks.push(v & 0xff, (v >> 8) & 0xff);
  }
  u32(v: number) {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  f32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.bytes(b);
  }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.bytes(b);
  }
  varuint(v: number) {
    if (v < 0) throw new Error("negative varuint");
    for (;;) {
      const part = v & 0x7f;
      v = Math.floor(v / 128);
      if (v) this.chunks.push(part | 0x80);
      else {
        this.chunks.push(part);
        break;
      }
    }
  }
  crdtId(v: CrdtId) {
    this.u8(v.part1);
    this.varuint(v.part2);
  }
  tag(index: number, tagType: number) {
    this.varuint((index << 4) | tagType);
  }
  taggedId(index: number, v: CrdtId) {
    this.tag(index, TagType.ID);
    this.crdtId(v);
  }
  taggedBool(index: number, v: boolean) {
    this.tag(index, TagType.Byte1);
    this.u8(v ? 1 : 0);
  }
  taggedInt(index: number, v: number) {
    this.tag(index, TagType.Byte4);
    this.u32(v);
  }
  taggedFloat(index: number, v: number) {
    this.tag(index, TagType.Byte4);
    this.f32(v);
  }
  subblock(index: number, body: (w: Writer) => void) {
    const inner = new Writer();
    body(inner);
    const data = inner.toBytes();
    this.tag(index, TagType.Length4);
    this.u32(data.length);
    this.bytes(data);
  }
  lwwString(index: number, timestamp: CrdtId, value: string) {
    this.subblock(index, (w) => {
      w.taggedId(1, timestamp);
      w.string(2, value);
    });
  }
  lwwBool(index: number, timestamp: CrdtId, value: boolean) {
    this.subblock(index, (w) => {
      w.taggedId(1, timestamp);
      w.taggedBool(2, value);
    });
  }
  string(index: number, value: string) {
    this.subblock(index, (w) => {
      const b = new TextEncoder().encode(value);
      w.varuint(b.length);
      w.u8(1);
      w.bytes(b);
    });
  }
  stringWithFormat(index: number, text: string, fmt: number) {
    this.subblock(index, (w) => {
      const b = new TextEncoder().encode(text);
      w.varuint(b.length);
      w.u8(1);
      w.bytes(b);
      w.taggedInt(2, fmt);
    });
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/* ------------------------------------------------------------------ */
/* Block-level structure                                               */
/* ------------------------------------------------------------------ */

export interface RawBlock {
  blockType: number;
  minVersion: number;
  currentVersion: number;
  payload: Uint8Array;
}

export function splitBlocks(file: Uint8Array): RawBlock[] {
  const r = new Reader(file);
  const header = new TextDecoder().decode(r.bytes(HEADER_V6.length));
  if (header !== HEADER_V6) throw new Error(`Not a .rm v6 file (header: ${JSON.stringify(header)})`);
  const blocks: RawBlock[] = [];
  while (!r.eof()) {
    const length = r.u32();
    const unknown = r.u8();
    if (unknown !== 0) throw new Error(`Unexpected block header byte ${unknown}`);
    const minVersion = r.u8();
    const currentVersion = r.u8();
    const blockType = r.u8();
    blocks.push({ blockType, minVersion, currentVersion, payload: r.bytes(length) });
  }
  return blocks;
}

export function joinBlocks(blocks: RawBlock[]): Uint8Array {
  const w = new Writer();
  w.bytes(new TextEncoder().encode(HEADER_V6));
  for (const b of blocks) {
    w.u32(b.payload.length);
    w.u8(0);
    w.u8(b.minVersion);
    w.u8(b.currentVersion);
    w.u8(b.blockType);
    w.bytes(b.payload);
  }
  return w.toBytes();
}

export const BlockType = {
  MigrationInfo: 0x00,
  SceneTree: 0x01,
  TreeNode: 0x02,
  SceneGlyphItem: 0x03,
  SceneGroupItem: 0x04,
  SceneLineItem: 0x05,
  SceneTextItem: 0x06,
  RootText: 0x07,
  SceneTombstoneItem: 0x08,
  AuthorIds: 0x09,
  PageInfo: 0x0a,
  SceneInfo: 0x0d,
} as const;

/* ------------------------------------------------------------------ */
/* Root text block parsing                                             */
/* ------------------------------------------------------------------ */

interface TextItem {
  itemId: CrdtId;
  leftId: CrdtId;
  rightId: CrdtId;
  deletedLength: number;
  value: string | number;
}

interface RootText {
  items: TextItem[];
  styles: Map<string, { charId: CrdtId; timestamp: CrdtId; style: ParagraphStyleValue }>;
}

function readSubblockBounded<T>(r: Reader, index: number, body: (r: Reader, end: number) => T): T {
  r.tag(index, TagType.Length4);
  const length = r.u32();
  const end = r.pos + length;
  const result = body(r, end);
  if (r.pos > end) throw new Error(`Subblock ${index} overflow`);
  r.pos = end;
  return result;
}

function readTextItem(r: Reader): TextItem {
  return readSubblockBounded(r, 0, (r, end) => {
    r.tag(2, TagType.ID);
    const itemId = r.crdtId();
    r.tag(3, TagType.ID);
    const leftId = r.crdtId();
    r.tag(4, TagType.ID);
    const rightId = r.crdtId();
    r.tag(5, TagType.Byte4);
    const deletedLength = r.u32();
    let value: string | number = "";
    if (r.pos < end && r.checkTag(6, TagType.Length4)) {
      value = readSubblockBounded(r, 6, (r) => {
        const strLen = r.varuint();
        r.u8();
        const text = new TextDecoder().decode(r.bytes(strLen));
        if (r.checkTag(2, TagType.Byte4)) {
          r.tag(2, TagType.Byte4);
          const fmt = r.u32();
          return fmt;
        }
        return text;
      });
    }
    return { itemId, leftId, rightId, deletedLength, value };
  });
}

export function parseRootText(payload: Uint8Array): RootText {
  const r = new Reader(payload);
  r.tag(1, TagType.ID);
  r.crdtId();

  const items: TextItem[] = [];
  const styles: RootText["styles"] = new Map();

  readSubblockBounded(r, 2, (r) => {
    readSubblockBounded(r, 1, (r) => {
      readSubblockBounded(r, 1, (r) => {
        const n = r.varuint();
        for (let i = 0; i < n; i++) items.push(readTextItem(r));
      });
    });
    readSubblockBounded(r, 2, (r) => {
      readSubblockBounded(r, 1, (r) => {
        const n = r.varuint();
        for (let i = 0; i < n; i++) {
          const charId = r.crdtId();
          r.tag(1, TagType.ID);
          const timestamp = r.crdtId();
         readSubblockBounded(r, 2, (r, end) => {
          const seventeen = r.u8();
          if (seventeen !== 17) throw new Error(`Unexpected format prefix ${seventeen}`);
          const code = r.u8();
          // Newer firmware appends tagged fields: 0x21 = Byte1 (heading level),
          // 0x34 = Byte4. Unknown trailing tags are left for the bounded-skip.
          let level = 0;
          while (r.pos < end) {
            const t = r.u8();
            if (t === 0x21) r.u8();
            else if (t === 0x34) level = r.u32();
            else break;
          }
          let style: number =
            code <= 7 || code === ParagraphStyle.NUMBERED ? code : ParagraphStyle.PLAIN;
          if (code === ParagraphStyle.BOLD && level >= 3) style = ParagraphStyle.HEADING2;
          styles.set(idKey(charId), {
            charId,
            timestamp,
            style: style as ParagraphStyleValue,
          });
        });
        }
      });
    });
  });
  return { items, styles };
}

/* ------------------------------------------------------------------ */
/* CRDT ordering and paragraph extraction                              */
/* ------------------------------------------------------------------ */

interface CharToken {
  charId: CrdtId;
  value: string | number;
}

function expandItems(items: TextItem[]): CharToken[] {
  const expanded: { itemId: CrdtId; leftId: CrdtId; rightId: CrdtId; value: string | number }[] = [];
  for (const item of items) {
    if (typeof item.value === "number") {
      expanded.push({ itemId: item.itemId, leftId: item.leftId, rightId: item.rightId, value: item.value });
      continue;
    }
    // Tombstones (deleted text) stay in the graph as empty placeholders:
    // live items may be anchored to their ids.
    const chars = item.deletedLength > 0 ? new Array<string>(item.deletedLength).fill("") : Array.from(item.value);
    if (chars.length === 0) continue;
    let itemId = item.itemId;
    let leftId = item.leftId;
    for (let i = 0; i < chars.length - 1; i++) {
      const rightId = id(itemId.part1, itemId.part2 + 1);
      expanded.push({ itemId, leftId, rightId, value: chars[i] });
      leftId = itemId;
      itemId = rightId;
    }
    expanded.push({ itemId, leftId, rightId: item.rightId, value: chars[chars.length - 1] });
  }

  const byId = new Map(expanded.map((e) => [idKey(e.itemId), e]));
  const START = "__start";
  const END = "__end";
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const allNodes = new Set<string>([START, END]);

  const sideKey = (sideId: CrdtId, side: "left" | "right"): string => {
    if (idEq(sideId, END_MARKER) || !byId.has(idKey(sideId))) return side === "left" ? START : END;
    return idKey(sideId);
  };
  const bump = (m: Map<string, number>, k: string, d: number) => m.set(k, (m.get(k) ?? 0) + d);
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };

  for (const e of expanded) {
    const k = idKey(e.itemId);
    const left = sideKey(e.leftId, "left");
    const right = sideKey(e.rightId, "right");
    allNodes.add(k);
    allNodes.add(left);
    allNodes.add(right);
    bump(inDegree, k, 1);
    push(dependents, left, k);
    bump(inDegree, right, 1);
    push(dependents, k, right);
  }

  const sortKey = (node: string): [number, number, number] => {
    if (node === START) return [0, 0, 0];
    if (node === END) return [2, 0, 0];
    const e = byId.get(node)!;
    return [1, -e.itemId.part1, e.itemId.part2];
  };
  const cmp = (a: string, b: string) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };

  const ready: string[] = [];
  const insertReady = (node: string) => {
    let lo = 0;
    let hi = ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(ready[mid], node) < 0) lo = mid + 1;
      else hi = mid;
    }
    ready.splice(lo, 0, node);
  };

  for (const node of allNodes) if (!(inDegree.get(node) ?? 0)) insertReady(node);

  const ordered: CharToken[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    const e = byId.get(node);
    if (e) ordered.push({ charId: e.itemId, value: e.value });
    if (node === END) break;
    for (const dep of dependents.get(node) ?? []) {
      bump(inDegree, dep, -1);
      if (!(inDegree.get(dep) ?? 0)) insertReady(dep);
    }
  }
  return ordered;
}

export function extractParagraphs(root: RootText): ParsedParagraph[] {
  const tokens = expandItems(root.items);
  const paragraphs: ParsedParagraph[] = [];
  let bold = false;
  let italic = false;

  let i = 0;
  while (i < tokens.length || paragraphs.length === 0) {
    let startKey = idKey(END_MARKER);
    if (i < tokens.length && tokens[i].value === "\n") {
      startKey = idKey(tokens[i].charId);
      i++;
    } else if (paragraphs.length > 0 && i >= tokens.length) {
      break;
    }
    const spans: TextSpan[] = [];
    while (i < tokens.length) {
      const v = tokens[i].value;
      if (typeof v === "number") {
        if (v === 1) bold = true;
        else if (v === 2) bold = false;
        else if (v === 3) italic = true;
        else if (v === 4) italic = false;
        i++;
        continue;
      }
      if (v === "\n") break;
      if (v !== "") {
        const last = spans[spans.length - 1];
        if (last && last.bold === bold && last.italic === italic) last.text += v;
        else spans.push({ text: v, bold, italic });
      }
      i++;
    }
    const style = root.styles.get(startKey)?.style ?? ParagraphStyle.PLAIN;
    paragraphs.push({ style, spans });
    if (i >= tokens.length) break;
  }
  return paragraphs;
}

export function isV6(file: Uint8Array): boolean {
  return new TextDecoder().decode(file.subarray(0, HEADER_V6.length)) === HEADER_V6;
}

export interface Highlight {
  text: string;
  color: number;
}

/**
 * Extract smart-highlight text (glyph ranges) from a page. These exist when
 * the highlighter recognized text underneath, e.g. on a PDF.
 */
export function parseHighlights(file: Uint8Array): Highlight[] {
  if (!isV6(file)) return [];
  const highlights: Highlight[] = [];
  for (const b of splitBlocks(file)) {
    if (b.blockType !== BlockType.SceneGlyphItem) continue;
    try {
      const r = new Reader(b.payload);
      r.tag(1, TagType.ID);
      r.crdtId();
      r.tag(2, TagType.ID);
      r.crdtId();
      r.tag(3, TagType.ID);
      r.crdtId();
      r.tag(4, TagType.ID);
      r.crdtId();
      r.tag(5, TagType.Byte4);
      const deletedLength = r.u32();
      if (deletedLength > 0 || !r.checkTag(6, TagType.Length4)) continue;
      readSubblockBounded(r, 6, (r) => {
        const itemType = r.u8();
        if (itemType !== 0x01) return;
        // GlyphRange: optional start(2)/length(3), color(4), text(5).
        if (r.checkTag(2, TagType.Byte4)) {
          r.tag(2, TagType.Byte4);
          r.u32();
        }
        if (r.checkTag(3, TagType.Byte4)) {
          r.tag(3, TagType.Byte4);
          r.u32();
        }
        r.tag(4, TagType.Byte4);
        const color = r.u32();
        const text = readSubblockBounded(r, 5, (r) => {
          const len = r.varuint();
          r.u8();
          return new TextDecoder().decode(r.bytes(len));
        });
        if (text.trim()) highlights.push({ text: text.trim(), color });
      });
    } catch {
      continue;
    }
  }
  return highlights;
}

export interface StrokePoint {
  x: number;
  y: number;
  width: number;
}

export interface Stroke {
  tool: number;
  color: number;
  colorRgba: [number, number, number, number] | null;
  thicknessScale: number;
  points: StrokePoint[];
}

/** Extract pen strokes from a page (v2 point format, firmware 3.x). */
export function parseStrokes(file: Uint8Array): Stroke[] {
  if (!isV6(file)) return [];
  const strokes: Stroke[] = [];
  for (const b of splitBlocks(file)) {
    if (b.blockType !== BlockType.SceneLineItem) continue;
    try {
      const r = new Reader(b.payload);
      const pointVersion = b.currentVersion;
      r.tag(1, TagType.ID);
      r.crdtId();
      r.tag(2, TagType.ID);
      r.crdtId();
      r.tag(3, TagType.ID);
      r.crdtId();
      r.tag(4, TagType.ID);
      r.crdtId();
      r.tag(5, TagType.Byte4);
      const deletedLength = r.u32();
      if (deletedLength > 0 || !r.checkTag(6, TagType.Length4)) continue;
      readSubblockBounded(r, 6, (r) => {
        const itemType = r.u8();
        if (itemType !== 0x03) return;
        r.tag(1, TagType.Byte4);
        const tool = r.u32();
        r.tag(2, TagType.Byte4);
        const color = r.u32();
        r.tag(3, TagType.Byte8);
        const thicknessScale = r.f64();
        r.tag(4, TagType.Byte4);
        r.f32();
        const points: StrokePoint[] = [];
        readSubblockBounded(r, 5, (r, end) => {
          const pointSize = pointVersion === 1 ? 0x18 : 0x0e;
          while (r.pos + pointSize <= end) {
            const x = r.f32();
            const y = r.f32();
            let width: number;
            if (pointVersion === 1) {
              r.f32();
              r.f32();
              width = Math.round(r.f32() * 4);
              r.f32();
            } else {
              r.u16();
              width = r.u16();
              r.u8();
              r.u8();
            }
            points.push({ x, y, width });
          }
        });
        r.tag(6, TagType.ID);
        r.crdtId();
        if (r.checkTag(7, TagType.ID)) {
          r.tag(7, TagType.ID);
          r.crdtId();
        }
        let colorRgba: Stroke["colorRgba"] = null;
        if (r.checkTag(8, TagType.Byte4)) {
          r.tag(8, TagType.Byte4);
          const packed = r.u32();
          colorRgba = [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff, (packed >> 24) & 0xff];
        }
        if (points.length) strokes.push({ tool, color, colorRgba, thicknessScale, points });
      });
    } catch {
      continue;
    }
  }
  return strokes;
}

/** Read the page's paper size from its SceneInfo block, if present. */
export function parsePaperSize(file: Uint8Array): [number, number] | null {
  if (!isV6(file)) return null;
  for (const b of splitBlocks(file)) {
    if (b.blockType !== BlockType.SceneInfo) continue;
    try {
      const r = new Reader(b.payload);
      readSubblockBounded(r, 1, (r) => {
        r.tag(1, TagType.ID);
        r.crdtId();
        r.tag(2, TagType.ID);
        r.crdtId();
      });
      // Optional lww bools (2, 3) then int pair (5).
      for (const idx of [2, 3]) {
        if (r.checkTag(idx, TagType.Length4)) {
          readSubblockBounded(r, idx, () => undefined);
        }
      }
      if (r.checkTag(5, TagType.Length4)) {
        return readSubblockBounded(r, 5, (r) => [r.u32(), r.u32()] as [number, number]);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parsePage(file: Uint8Array): ParsedPage {
  const warnings: string[] = [];
  if (!isV6(file)) {
    const header = new TextDecoder().decode(file.subarray(0, 32));
    if (header.startsWith("reMarkable .lines file")) {
      // Pre-3.0 firmware page: ink only, no typed text to extract.
      return { paragraphs: [], hasStrokes: true, warnings: [] };
    }
    throw new Error(`Not a reMarkable page file (header: ${JSON.stringify(header)})`);
  }
  const blocks = splitBlocks(file);
  let hasStrokes = false;
  const paragraphs: ParsedParagraph[] = [];
  for (const b of blocks) {
    if (b.blockType === BlockType.SceneLineItem) hasStrokes = true;
    if (b.blockType === BlockType.RootText) {
      try {
        paragraphs.push(...extractParagraphs(parseRootText(b.payload)));
      } catch (e) {
        warnings.push(`Could not parse text block: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return { paragraphs, hasStrokes, warnings };
}

/* ------------------------------------------------------------------ */
/* Document generation                                                 */
/* ------------------------------------------------------------------ */

export interface OutSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface OutParagraph {
  style: ParagraphStyleValue;
  spans: OutSpan[];
}

function uuidToBytesLE(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const swap = (arr: Uint8Array, i: number, j: number) => {
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  };
  swap(b, 0, 3);
  swap(b, 1, 2);
  swap(b, 4, 5);
  swap(b, 6, 7);
  return b;
}

/**
 * Build a complete single-page .rm file containing the given paragraphs as
 * typed text. Mirrors rmscene's simple_text_document, extended with
 * paragraph styles and inline bold/italic format codes.
 */
export function buildTextPage(paragraphs: OutParagraph[], authorUuid: string): Uint8Array {
  interface SeqItem {
    itemId: CrdtId;
    leftId: CrdtId;
    rightId: CrdtId;
    value: string | number;
  }
  const items: SeqItem[] = [];
  const styleEntries: { charId: CrdtId; timestamp: CrdtId; style: ParagraphStyleValue }[] = [];

  let next = 16;
  let prevId = END_MARKER;
  let charCount = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const chars = Array.from(text);
    const itemId = id(1, next);
    items.push({ itemId, leftId: prevId, rightId: END_MARKER, value: text });
    next += chars.length;
    charCount += chars.length;
    prevId = id(1, next - 1);
  };
  const pushCode = (code: number) => {
    const itemId = id(1, next);
    items.push({ itemId, leftId: prevId, rightId: END_MARKER, value: code });
    next += 1;
    prevId = itemId;
  };

  const paragraphStartIds: CrdtId[] = [];
  let bold = false;
  let italic = false;
  paragraphs.forEach((p, pi) => {
    if (pi === 0) {
      paragraphStartIds.push(END_MARKER);
    } else {
      const newlineId = id(1, next);
      pushText("\n");
      paragraphStartIds.push(newlineId);
    }
    for (const span of p.spans) {
      const wantBold = !!span.bold;
      const wantItalic = !!span.italic;
      if (wantBold !== bold) {
        pushCode(wantBold ? 1 : 2);
        bold = wantBold;
      }
      if (wantItalic !== italic) {
        pushCode(wantItalic ? 3 : 4);
        italic = wantItalic;
      }
      pushText(span.text);
    }
  });
  if (bold) pushCode(2);
  if (italic) pushCode(4);

  paragraphs.forEach((p, pi) => {
    styleEntries.push({ charId: paragraphStartIds[pi], timestamp: id(1, next++), style: p.style });
  });

  const rootText = new Writer();
  rootText.taggedId(1, END_MARKER);
  rootText.subblock(2, (w) => {
    w.subblock(1, (w) => {
      w.subblock(1, (w) => {
        w.varuint(items.length);
        for (const item of items) {
          w.subblock(0, (w) => {
            w.taggedId(2, item.itemId);
            w.taggedId(3, item.leftId);
            w.taggedId(4, item.rightId);
            w.taggedInt(5, 0);
            if (typeof item.value === "number") w.stringWithFormat(6, "", item.value);
            else if (item.value) w.string(6, item.value);
          });
        }
      });
    });
    w.subblock(2, (w) => {
      w.subblock(1, (w) => {
        w.varuint(styleEntries.length);
        for (const s of styleEntries) {
          w.crdtId(s.charId);
          w.taggedId(1, s.timestamp);
          w.subblock(2, (w) => {
          w.u8(17);
          if (s.style === ParagraphStyle.HEADING2) {
            // Byte-exact extended record captured from device output:
            // 11 03 21 02 34 03 00 00 00
            w.u8(ParagraphStyle.BOLD);
            w.u8(0x21);
            w.u8(2);
            w.u8(0x34);
            w.u32(3);
          } else {
            w.u8(s.style);
          }
        });
        }
      });
    });
  });
  rootText.subblock(3, (w) => {
    w.f64(-468.0);
    w.f64(234.0);
  });
  rootText.taggedFloat(4, 936.0);

  const authorIds = new Writer();
  authorIds.varuint(1);
  authorIds.subblock(0, (w) => {
    const b = uuidToBytesLE(authorUuid);
    w.varuint(b.length);
    w.bytes(b);
    w.u16(1);
  });

  const migration = new Writer();
  migration.taggedId(1, id(1, 1));
  migration.taggedBool(2, true);
  migration.taggedBool(3, false);

  const lineCount = paragraphs.length;
  const pageInfo = new Writer();
  pageInfo.taggedInt(1, 1);
  pageInfo.taggedInt(2, 0);
  pageInfo.taggedInt(3, charCount + 1);
  pageInfo.taggedInt(4, lineCount);
  pageInfo.taggedInt(5, 0);

  const sceneTree = new Writer();
  sceneTree.taggedId(1, id(0, 11));
  sceneTree.taggedId(2, id(0, 0));
  sceneTree.taggedBool(3, true);
  sceneTree.subblock(4, (w) => w.taggedId(1, id(0, 1)));

  const treeNodeRoot = new Writer();
  treeNodeRoot.taggedId(1, id(0, 1));
  treeNodeRoot.lwwString(2, END_MARKER, "");
  treeNodeRoot.lwwBool(3, END_MARKER, true);

  const treeNodeLayer = new Writer();
  treeNodeLayer.taggedId(1, id(0, 11));
  treeNodeLayer.lwwString(2, id(0, 12), "Layer 1");
  treeNodeLayer.lwwBool(3, END_MARKER, true);

  const groupItem = new Writer();
  groupItem.taggedId(1, id(0, 1));
  groupItem.taggedId(2, id(0, 13));
  groupItem.taggedId(3, END_MARKER);
  groupItem.taggedId(4, END_MARKER);
  groupItem.taggedInt(5, 0);
  groupItem.subblock(6, (w) => {
    w.u8(0x02);
    w.taggedId(2, id(0, 11));
  });

  const blocks: RawBlock[] = [
    { blockType: BlockType.AuthorIds, minVersion: 1, currentVersion: 1, payload: authorIds.toBytes() },
    { blockType: BlockType.MigrationInfo, minVersion: 1, currentVersion: 1, payload: migration.toBytes() },
    { blockType: BlockType.PageInfo, minVersion: 0, currentVersion: 1, payload: pageInfo.toBytes() },
    { blockType: BlockType.SceneTree, minVersion: 1, currentVersion: 1, payload: sceneTree.toBytes() },
    { blockType: BlockType.RootText, minVersion: 1, currentVersion: 1, payload: rootText.toBytes() },
    { blockType: BlockType.TreeNode, minVersion: 1, currentVersion: 2, payload: treeNodeRoot.toBytes() },
    { blockType: BlockType.TreeNode, minVersion: 1, currentVersion: 2, payload: treeNodeLayer.toBytes() },
    { blockType: BlockType.SceneGroupItem, minVersion: 1, currentVersion: 1, payload: groupItem.toBytes() },
  ];
  return joinBlocks(blocks);
}
