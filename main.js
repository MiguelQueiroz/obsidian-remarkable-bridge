var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => RemarkableBridge
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_state = require("@codemirror/state");

// src/store.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var import_crypto = require("crypto");

// src/rm/codec.ts
var HEADER_V6 = "reMarkable .lines file, version=6          ";
var TagType = {
  ID: 15,
  Length4: 12,
  Byte8: 8,
  Byte4: 4,
  Byte1: 1
};
var id = (part1, part2) => ({ part1, part2 });
var idEq = (a, b) => a.part1 === b.part1 && a.part2 === b.part2;
var idKey = (a) => `${a.part1}:${a.part2}`;
var END_MARKER = id(0, 0);
var ParagraphStyle = {
  BASIC: 0,
  PLAIN: 1,
  HEADING: 2,
  BOLD: 3,
  BULLET: 4,
  BULLET2: 5,
  CHECKBOX: 6,
  CHECKBOX_CHECKED: 7
};
var Reader = class {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get length() {
    return this.buf.length;
  }
  eof() {
    return this.pos >= this.buf.length;
  }
  bytes(n) {
    if (this.pos + n > this.buf.length) throw new Error("EOF");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8() {
    if (this.pos >= this.buf.length) throw new Error("EOF");
    return this.buf[this.pos++];
  }
  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  varuint() {
    let shift = 0;
    let result = 0;
    for (; ; ) {
      const b = this.u8();
      result += (b & 127) * 2 ** shift;
      shift += 7;
      if (!(b & 128)) break;
    }
    return result;
  }
  crdtId() {
    return id(this.u8(), this.varuint());
  }
  peekTag() {
    const start = this.pos;
    try {
      const x = this.varuint();
      return { index: x >> 4, tagType: x & 15 };
    } catch {
      return null;
    } finally {
      this.pos = start;
    }
  }
  tag(expectedIndex, expectedType) {
    const start = this.pos;
    const x = this.varuint();
    const index = x >> 4;
    const tagType = x & 15;
    if (index !== expectedIndex || tagType !== expectedType) {
      this.pos = start;
      throw new Error(
        `Expected tag ${expectedIndex}/0x${expectedType.toString(16)}, got ${index}/0x${tagType.toString(16)} at ${start}`
      );
    }
  }
  checkTag(expectedIndex, expectedType) {
    const t = this.peekTag();
    return t !== null && t.index === expectedIndex && t.tagType === expectedType;
  }
};
var Writer = class _Writer {
  constructor() {
    this.chunks = [];
  }
  bytes(b) {
    for (const x of b) this.chunks.push(x);
  }
  u8(v) {
    this.chunks.push(v & 255);
  }
  u16(v) {
    this.chunks.push(v & 255, v >> 8 & 255);
  }
  u32(v) {
    this.chunks.push(v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255);
  }
  f32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.bytes(b);
  }
  f64(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.bytes(b);
  }
  varuint(v) {
    if (v < 0) throw new Error("negative varuint");
    for (; ; ) {
      const part = v & 127;
      v = Math.floor(v / 128);
      if (v) this.chunks.push(part | 128);
      else {
        this.chunks.push(part);
        break;
      }
    }
  }
  crdtId(v) {
    this.u8(v.part1);
    this.varuint(v.part2);
  }
  tag(index, tagType) {
    this.varuint(index << 4 | tagType);
  }
  taggedId(index, v) {
    this.tag(index, TagType.ID);
    this.crdtId(v);
  }
  taggedBool(index, v) {
    this.tag(index, TagType.Byte1);
    this.u8(v ? 1 : 0);
  }
  taggedInt(index, v) {
    this.tag(index, TagType.Byte4);
    this.u32(v);
  }
  taggedFloat(index, v) {
    this.tag(index, TagType.Byte4);
    this.f32(v);
  }
  subblock(index, body) {
    const inner = new _Writer();
    body(inner);
    const data = inner.toBytes();
    this.tag(index, TagType.Length4);
    this.u32(data.length);
    this.bytes(data);
  }
  lwwString(index, timestamp, value) {
    this.subblock(index, (w) => {
      w.taggedId(1, timestamp);
      w.string(2, value);
    });
  }
  lwwBool(index, timestamp, value) {
    this.subblock(index, (w) => {
      w.taggedId(1, timestamp);
      w.taggedBool(2, value);
    });
  }
  string(index, value) {
    this.subblock(index, (w) => {
      const b = new TextEncoder().encode(value);
      w.varuint(b.length);
      w.u8(1);
      w.bytes(b);
    });
  }
  stringWithFormat(index, text, fmt) {
    this.subblock(index, (w) => {
      const b = new TextEncoder().encode(text);
      w.varuint(b.length);
      w.u8(1);
      w.bytes(b);
      w.taggedInt(2, fmt);
    });
  }
  toBytes() {
    return Uint8Array.from(this.chunks);
  }
};
function splitBlocks(file) {
  const r = new Reader(file);
  const header = new TextDecoder().decode(r.bytes(HEADER_V6.length));
  if (header !== HEADER_V6) throw new Error(`Not a .rm v6 file (header: ${JSON.stringify(header)})`);
  const blocks = [];
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
function joinBlocks(blocks) {
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
var BlockType = {
  MigrationInfo: 0,
  SceneTree: 1,
  TreeNode: 2,
  SceneGlyphItem: 3,
  SceneGroupItem: 4,
  SceneLineItem: 5,
  SceneTextItem: 6,
  RootText: 7,
  SceneTombstoneItem: 8,
  AuthorIds: 9,
  PageInfo: 10,
  SceneInfo: 13
};
function readSubblockBounded(r, index, body) {
  r.tag(index, TagType.Length4);
  const length = r.u32();
  const end = r.pos + length;
  const result = body(r, end);
  if (r.pos > end) throw new Error(`Subblock ${index} overflow`);
  r.pos = end;
  return result;
}
function readTextItem(r) {
  return readSubblockBounded(r, 0, (r2, end) => {
    r2.tag(2, TagType.ID);
    const itemId = r2.crdtId();
    r2.tag(3, TagType.ID);
    const leftId = r2.crdtId();
    r2.tag(4, TagType.ID);
    const rightId = r2.crdtId();
    r2.tag(5, TagType.Byte4);
    const deletedLength = r2.u32();
    let value = "";
    if (r2.pos < end && r2.checkTag(6, TagType.Length4)) {
      value = readSubblockBounded(r2, 6, (r3) => {
        const strLen = r3.varuint();
        r3.u8();
        const text = new TextDecoder().decode(r3.bytes(strLen));
        if (r3.checkTag(2, TagType.Byte4)) {
          r3.tag(2, TagType.Byte4);
          const fmt = r3.u32();
          return fmt;
        }
        return text;
      });
    }
    return { itemId, leftId, rightId, deletedLength, value };
  });
}
function parseRootText(payload) {
  const r = new Reader(payload);
  r.tag(1, TagType.ID);
  r.crdtId();
  const items = [];
  const styles = /* @__PURE__ */ new Map();
  readSubblockBounded(r, 2, (r2) => {
    readSubblockBounded(r2, 1, (r3) => {
      readSubblockBounded(r3, 1, (r4) => {
        const n = r4.varuint();
        for (let i = 0; i < n; i++) items.push(readTextItem(r4));
      });
    });
    readSubblockBounded(r2, 2, (r3) => {
      readSubblockBounded(r3, 1, (r4) => {
        const n = r4.varuint();
        for (let i = 0; i < n; i++) {
          const charId = r4.crdtId();
          r4.tag(1, TagType.ID);
          const timestamp = r4.crdtId();
          readSubblockBounded(r4, 2, (r5) => {
            const seventeen = r5.u8();
            if (seventeen !== 17) throw new Error(`Unexpected format prefix ${seventeen}`);
            const code = r5.u8();
            styles.set(idKey(charId), {
              charId,
              timestamp,
              style: code <= 7 ? code : ParagraphStyle.PLAIN
            });
          });
        }
      });
    });
  });
  return { items, styles };
}
function expandItems(items) {
  const expanded = [];
  for (const item of items) {
    if (typeof item.value === "number") {
      expanded.push({ itemId: item.itemId, leftId: item.leftId, rightId: item.rightId, value: item.value });
      continue;
    }
    const chars = item.deletedLength > 0 ? new Array(item.deletedLength).fill("") : Array.from(item.value);
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
  const inDegree = /* @__PURE__ */ new Map();
  const dependents = /* @__PURE__ */ new Map();
  const allNodes = /* @__PURE__ */ new Set([START, END]);
  const sideKey = (sideId, side) => {
    if (idEq(sideId, END_MARKER) || !byId.has(idKey(sideId))) return side === "left" ? START : END;
    return idKey(sideId);
  };
  const bump = (m, k, d) => m.set(k, (m.get(k) ?? 0) + d);
  const push = (m, k, v) => {
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
  const sortKey = (node) => {
    if (node === START) return [0, 0, 0];
    if (node === END) return [2, 0, 0];
    const e = byId.get(node);
    return [1, -e.itemId.part1, e.itemId.part2];
  };
  const cmp = (a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };
  const ready = [];
  const insertReady = (node) => {
    let lo = 0;
    let hi = ready.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (cmp(ready[mid], node) < 0) lo = mid + 1;
      else hi = mid;
    }
    ready.splice(lo, 0, node);
  };
  for (const node of allNodes) if (!(inDegree.get(node) ?? 0)) insertReady(node);
  const ordered = [];
  while (ready.length) {
    const node = ready.shift();
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
function extractParagraphs(root) {
  const tokens = expandItems(root.items);
  const paragraphs = [];
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
    const spans = [];
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
function isV6(file) {
  return new TextDecoder().decode(file.subarray(0, HEADER_V6.length)) === HEADER_V6;
}
function parsePage(file) {
  const warnings = [];
  if (!isV6(file)) {
    const header = new TextDecoder().decode(file.subarray(0, 32));
    if (header.startsWith("reMarkable .lines file")) {
      return { paragraphs: [], hasStrokes: true, warnings: [] };
    }
    throw new Error(`Not a reMarkable page file (header: ${JSON.stringify(header)})`);
  }
  const blocks = splitBlocks(file);
  let hasStrokes = false;
  const paragraphs = [];
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
function uuidToBytesLE(uuid) {
  const hex = uuid.replace(/-/g, "");
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const swap = (arr, i, j) => {
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
function buildTextPage(paragraphs, authorUuid) {
  const items = [];
  const styleEntries = [];
  let next = 16;
  let prevId = END_MARKER;
  let charCount = 0;
  const pushText = (text) => {
    if (!text) return;
    const chars = Array.from(text);
    const itemId = id(1, next);
    items.push({ itemId, leftId: prevId, rightId: END_MARKER, value: text });
    next += chars.length;
    charCount += chars.length;
    prevId = id(1, next - 1);
  };
  const pushCode = (code) => {
    const itemId = id(1, next);
    items.push({ itemId, leftId: prevId, rightId: END_MARKER, value: code });
    next += 1;
    prevId = itemId;
  };
  const paragraphStartIds = [];
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
    w.subblock(1, (w2) => {
      w2.subblock(1, (w3) => {
        w3.varuint(items.length);
        for (const item of items) {
          w3.subblock(0, (w4) => {
            w4.taggedId(2, item.itemId);
            w4.taggedId(3, item.leftId);
            w4.taggedId(4, item.rightId);
            w4.taggedInt(5, 0);
            if (typeof item.value === "number") w4.stringWithFormat(6, "", item.value);
            else if (item.value) w4.string(6, item.value);
          });
        }
      });
    });
    w.subblock(2, (w2) => {
      w2.subblock(1, (w3) => {
        w3.varuint(styleEntries.length);
        for (const s of styleEntries) {
          w3.crdtId(s.charId);
          w3.taggedId(1, s.timestamp);
          w3.subblock(2, (w4) => {
            w4.u8(17);
            w4.u8(s.style);
          });
        }
      });
    });
  });
  rootText.subblock(3, (w) => {
    w.f64(-468);
    w.f64(234);
  });
  rootText.taggedFloat(4, 936);
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
    w.u8(2);
    w.taggedId(2, id(0, 11));
  });
  const blocks = [
    { blockType: BlockType.AuthorIds, minVersion: 1, currentVersion: 1, payload: authorIds.toBytes() },
    { blockType: BlockType.MigrationInfo, minVersion: 1, currentVersion: 1, payload: migration.toBytes() },
    { blockType: BlockType.PageInfo, minVersion: 0, currentVersion: 1, payload: pageInfo.toBytes() },
    { blockType: BlockType.SceneTree, minVersion: 1, currentVersion: 1, payload: sceneTree.toBytes() },
    { blockType: BlockType.RootText, minVersion: 1, currentVersion: 1, payload: rootText.toBytes() },
    { blockType: BlockType.TreeNode, minVersion: 1, currentVersion: 2, payload: treeNodeRoot.toBytes() },
    { blockType: BlockType.TreeNode, minVersion: 1, currentVersion: 2, payload: treeNodeLayer.toBytes() },
    { blockType: BlockType.SceneGroupItem, minVersion: 1, currentVersion: 1, payload: groupItem.toBytes() }
  ];
  return joinBlocks(blocks);
}

// src/store.ts
var StoreError = class extends Error {
};
function defaultStorePath() {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop"
    );
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? "", "remarkable", "desktop");
  }
  return path.join(os.homedir(), ".local", "share", "remarkable", "desktop");
}
var RemarkableStore = class {
  constructor(root) {
    this.root = root;
  }
  /** Sanity-check the layout before touching anything. */
  verify() {
    if (!fs.existsSync(this.root)) {
      return { ok: false, documents: 0, reason: `Store not found at ${this.root}. Is the reMarkable desktop app installed?` };
    }
    const metas = fs.readdirSync(this.root).filter((f) => f.endsWith(".metadata"));
    if (metas.length === 0) {
      return { ok: false, documents: 0, reason: "Store contains no documents; open the reMarkable desktop app once first." };
    }
    try {
      const sample = JSON.parse(fs.readFileSync(path.join(this.root, metas[0]), "utf8"));
      if (typeof sample.visibleName !== "string" || typeof sample.type !== "string") {
        return { ok: false, documents: metas.length, reason: "Store layout not recognized (app update?). Refusing to write." };
      }
    } catch (e) {
      return { ok: false, documents: metas.length, reason: `Could not read store metadata: ${e}` };
    }
    return { ok: true, documents: metas.length };
  }
  readMetadata(docId) {
    return JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.metadata`), "utf8"));
  }
  writeMetadata(docId, meta) {
    fs.writeFileSync(path.join(this.root, `${docId}.metadata`), JSON.stringify(meta, null, 4));
  }
  /** Find a folder by name at the root level, or create it. Returns its id. */
  ensureFolder(name) {
    for (const f of fs.readdirSync(this.root)) {
      if (!f.endsWith(".metadata")) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.root, f), "utf8"));
        if (meta.type === "CollectionType" && meta.visibleName === name && meta.parent === "" && !meta.deleted) {
          return f.slice(0, -".metadata".length);
        }
      } catch {
        continue;
      }
    }
    const id2 = (0, import_crypto.randomUUID)();
    const now = String(Date.now());
    this.writeMetadata(id2, {
      createdTime: now,
      deleted: false,
      lastModified: now,
      lastOpened: "0",
      lastOpenedPage: 0,
      metadatamodified: false,
      modified: false,
      new: false,
      parent: "",
      pinned: false,
      source: "",
      synced: false,
      type: "CollectionType",
      version: 0,
      visibleName: name
    });
    fs.writeFileSync(path.join(this.root, `${id2}.content`), JSON.stringify({ tags: [] }, null, 4));
    return id2;
  }
  /** Create a fresh typed-text document. Returns the new document id. */
  createTextDocument(name, parentId, pages) {
    const check = this.verify();
    if (!check.ok) throw new StoreError(check.reason);
    const docId = (0, import_crypto.randomUUID)();
    const authorUuid = (0, import_crypto.randomUUID)();
    const docDir = path.join(this.root, docId);
    fs.mkdirSync(docDir);
    const pageIds = [];
    for (const paragraphs of pages) {
      const pageId = (0, import_crypto.randomUUID)();
      pageIds.push(pageId);
      fs.writeFileSync(path.join(docDir, `${pageId}.rm`), buildTextPage(paragraphs, authorUuid));
    }
    const idx = (i) => `a${String.fromCharCode(97 + i)}`;
    const content = {
      cPages: {
        lastOpened: { timestamp: "0:0", value: pageIds[0] },
        original: { timestamp: "0:0", value: 0 },
        pages: pageIds.map((pid, i) => ({ id: pid, idx: { timestamp: "0:1", value: idx(i) } })),
        uuids: []
      },
      coverPageNumber: 0,
      documentMetadata: {},
      dummyDocument: false,
      extraMetadata: {},
      fileType: "notebook",
      fontName: "",
      formatVersion: 2,
      lineHeight: 0,
      orientation: "portrait",
      pageCount: pageIds.length,
      pageTags: [],
      sizeInBytes: "0",
      tags: [],
      textAlignment: "justify",
      textScale: 0,
      zoomMode: "bestFit"
    };
    const now = String(Date.now());
    fs.writeFileSync(path.join(this.root, `${docId}.content`), JSON.stringify(content, null, 4));
    fs.writeFileSync(path.join(this.root, `${docId}.local`), JSON.stringify({ contentFormatVersion: 2 }, null, 4));
    fs.writeFileSync(path.join(this.root, `${docId}.pagedata`), "Blank\n".repeat(pageIds.length));
    this.writeMetadata(docId, {
      createdTime: now,
      deleted: false,
      lastModified: now,
      lastOpened: "0",
      lastOpenedPage: 0,
      metadatamodified: false,
      modified: false,
      new: false,
      parent: parentId,
      pinned: false,
      source: "",
      synced: false,
      type: "DocumentType",
      version: 0,
      visibleName: name
    });
    return docId;
  }
  docExists(docId) {
    return fs.existsSync(path.join(this.root, `${docId}.metadata`));
  }
  /** Read all pages of a document, in page order. */
  readTextDocument(docId) {
    const meta = this.readMetadata(docId);
    const content = JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.content`), "utf8"));
    const pageEntries = content.cPages?.pages ?? [];
    const pages = [];
    for (const p of pageEntries) {
      const rmPath = path.join(this.root, docId, `${p.id}.rm`);
      if (!fs.existsSync(rmPath)) {
        pages.push({ paragraphs: [], hasStrokes: false, warnings: [`Missing page file ${p.id}.rm`] });
        continue;
      }
      pages.push(parsePage(fs.readFileSync(rmPath)));
    }
    return { pages, lastModified: meta.lastModified };
  }
  /** Move a document to the device trash (never hard-delete). */
  trashDocument(docId) {
    const meta = this.readMetadata(docId);
    meta.parent = "trash";
    meta.lastModified = String(Date.now());
    meta.metadatamodified = true;
    this.writeMetadata(docId, meta);
  }
  /**
   * Watch tracked documents for changes arriving from the device.
   * Returns a dispose function.
   */
  watch(docIds, onChange) {
    let timer = null;
    const pending = /* @__PURE__ */ new Set();
    let watcher = null;
    try {
      watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const docId = String(filename).split(path.sep)[0].replace(/\.(metadata|content|local|pagedata)$/, "");
        if (!docIds().has(docId)) return;
        pending.add(docId);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          for (const id2 of pending) onChange(id2);
          pending.clear();
        }, 2e3);
      });
    } catch {
      return () => {
      };
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }
};

// src/academic.ts
var NOTES_HEADING = "\u2E3B Notes \u2E3B";
var STASH_MARKER = (n) => `\u27E6stash ${n}\u27E7`;
var STASH_RE = /⟦stash (\d+)⟧/g;
var CHEAT_MARKER = "\u2E3B Syntax cheat sheet (not copied back) \u2E3B";
function inlineToSpans(text) {
  const spans = [];
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
    } else if (text[i] === "*" || text[i] === "_" && (i === 0 || /[\s(]/.test(text[i - 1]) || italic)) {
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
function spansToInline(spans) {
  return spans.map((s) => {
    let t = s.text;
    if (s.italic) t = `*${t}*`;
    if (s.bold) t = `**${t}**`;
    return t;
  }).join("");
}
function markdownToDevice(body, appendCheatSheet = false) {
  const stash = [];
  let text = body.replace(/^```[\s\S]*?^```[ \t]*$/gm, (block) => {
    stash.push(block);
    return STASH_MARKER(stash.length - 1);
  });
  const defs = /* @__PURE__ */ new Map();
  text = text.replace(/^\[\^([^\]]+)\]:[ \t]?(.*(?:\n(?:[ \t]+.*|$))*)/gm, (_m, key, def) => {
    defs.set(key, def.replace(/\n[ \t]+/g, " ").trim());
    return "";
  });
  const order = [];
  text = text.replace(/\[\^([^\]]+)\]/g, (_m, key) => {
    let n = order.indexOf(key);
    if (n === -1) {
      order.push(key);
      n = order.length - 1;
    }
    return `[${n + 1}]`;
  });
  const paragraphs = [];
  const lines = text.replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
  for (const line of lines) {
    let style = ParagraphStyle.PLAIN;
    let rest = line;
    const heading = line.match(/^(#{1,6})[ \t]+(.*)$/);
    const bullet = line.match(/^[ \t]*[-*][ \t]+(.*)$/);
    if (heading) {
      style = heading[1].length === 1 ? ParagraphStyle.HEADING : ParagraphStyle.BOLD;
      rest = heading[2];
    } else if (bullet && !line.match(/^[ \t]*[-*][ \t]*$/)) {
      style = ParagraphStyle.BULLET;
      rest = bullet[1];
    }
    paragraphs.push({ style, spans: inlineToSpans(rest) });
  }
  if (order.length || defs.size) {
    paragraphs.push({ style: ParagraphStyle.PLAIN, spans: [] });
    paragraphs.push({ style: ParagraphStyle.BOLD, spans: [{ text: NOTES_HEADING }] });
    order.forEach((key, i) => {
      const def = defs.get(key) ?? "";
      if (!defs.has(key)) {
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
      "Bold, italics, headings: use the device formatting bar"
    ]) {
      paragraphs.push({ style: ParagraphStyle.BULLET, spans: [{ text: line }] });
    }
  }
  return { paragraphs, stash };
}
function deviceToMarkdown(paragraphs, stash) {
  const warnings = [];
  const lines = paragraphs.map((p) => ({
    style: p.style,
    text: spansToInline(p.spans)
  }));
  let notesStart = -1;
  let cheatStart = -1;
  lines.forEach((l, i) => {
    const plain = l.text.replace(/\*/g, "").trim();
    if (notesStart === -1 && plain === NOTES_HEADING) notesStart = i;
    if (cheatStart === -1 && plain === CHEAT_MARKER) cheatStart = i;
  });
  const bodyEnd = Math.min(notesStart === -1 ? lines.length : notesStart, cheatStart === -1 ? lines.length : cheatStart);
  const noteLines = notesStart === -1 ? [] : lines.slice(notesStart + 1, cheatStart === -1 || cheatStart < notesStart ? void 0 : cheatStart);
  const defs = /* @__PURE__ */ new Map();
  for (const l of noteLines) {
    const m = l.text.match(/^\s*\[(?:unused: )?([^\]]+)\]\s*(.*)$/);
    if (m) defs.set(m[1], m[2].trim());
    else if (l.text.trim()) {
      const lastKey = [...defs.keys()].pop();
      if (lastKey) defs.set(lastKey, `${defs.get(lastKey)} ${l.text.trim()}`.trim());
      else warnings.push(`Ignored stray line in Notes section: "${l.text.trim()}"`);
    }
  }
  const usedMarkers = [];
  const newDefs = [];
  const takeFootnotes = (text) => text.replace(/\(\(([\s\S]+?)\)\)/g, (_m, def) => {
    newDefs.push(def.trim());
    return `\uE000${newDefs.length - 1}\uE001`;
  }).replace(/\[(\d+)\]/g, (m, n) => {
    if (!defs.has(n)) {
      warnings.push(`Marker [${n}] has no entry in the Notes section; left as literal text.`);
      return m;
    }
    usedMarkers.push(n);
    return `\uE002${n}\uE003`;
  });
  const bodyLines = [];
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
  let body = bodyLines.join("\n");
  const finalDefs = [];
  body = body.replace(/\uE000(\d+)\uE001|\uE002(\d+)\uE003/g, (_m, newIdx, oldKey) => {
    const def = newIdx !== void 0 ? newDefs[parseInt(newIdx, 10)] : defs.get(oldKey) ?? "";
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
    body = `${body}

${numbered}`;
  }
  body = body.replace(STASH_RE, (m, n) => {
    const idx = parseInt(n, 10);
    if (idx >= stash.length) {
      warnings.push(`Placeholder ${m} has no stashed block; removed.`);
      return "";
    }
    return stash[idx];
  });
  return { markdown: body.trimEnd() + "\n", warnings };
}

// src/main.ts
var DEFAULT_SETTINGS = {
  storePath: "",
  deviceFolder: "Obsidian",
  trashAfterPull: true,
  lockWhileOut: true,
  appendCheatSheet: true,
  checkouts: {}
};
var FM_ID = "remarkable-id";
var RemarkableBridge = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.stopWatch = null;
    this.changedDocs = /* @__PURE__ */ new Set();
  }
  store() {
    return new RemarkableStore(this.settings.storePath || defaultStorePath());
  }
  checkoutForFile(file) {
    return Object.values(this.settings.checkouts).find((c) => c.path === file.path);
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addCommand({
      id: "send-to-remarkable",
      name: "Send note to reMarkable",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || this.checkoutForFile(file)) return false;
        if (!checking) void this.sendNote(file);
        return true;
      }
    });
    this.addCommand({
      id: "pull-from-remarkable",
      name: "Pull note back from reMarkable",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.checkoutForFile(file)) return false;
        if (!checking) void this.pullNote(file);
        return true;
      }
    });
    this.addCommand({
      id: "force-release",
      name: "Force release (discard reMarkable copy)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.checkoutForFile(file)) return false;
        if (!checking) void this.forceRelease(file);
        return true;
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
        const out = this.checkoutForFile(file);
        menu.addItem(
          (item) => item.setTitle(out ? "Pull back from reMarkable" : "Send to reMarkable").setIcon("tablet").onClick(() => out ? this.pullNote(file) : this.sendNote(file))
        );
      })
    );
    this.registerEditorExtension(
      import_state.EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || !this.settings.lockWhileOut) return tr;
        const info = tr.startState.field(import_obsidian.editorInfoField, false);
        const file = info?.file;
        if (file && this.checkoutForFile(file)) {
          new import_obsidian.Notice("This note is on your reMarkable. Pull it back to edit here.");
          return [];
        }
        return tr;
      })
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshBanners()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshBanners()));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        for (const c of Object.values(this.settings.checkouts)) {
          if (c.path === oldPath) {
            c.path = file.path;
            void this.saveData(this.settings);
          }
        }
      })
    );
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    this.startWatcher();
    this.app.workspace.onLayoutReady(() => this.refreshBanners());
  }
  onunload() {
    this.stopWatch?.();
    for (const el of document.querySelectorAll(".rm-bridge-banner")) el.remove();
  }
  startWatcher() {
    this.stopWatch?.();
    this.stopWatch = this.store().watch(
      () => new Set(Object.keys(this.settings.checkouts)),
      (docId) => {
        if (this.changedDocs.has(docId)) return;
        this.changedDocs.add(docId);
        const c = this.settings.checkouts[docId];
        if (!c) return;
        const name = c.path.split("/").pop();
        const notice = new import_obsidian.Notice("", 3e4);
        notice.messageEl.createSpan({ text: `"${name}" changed on reMarkable. ` });
        const link = notice.messageEl.createEl("a", { text: "Pull it back" });
        link.onclick = () => {
          const file = this.app.vault.getFileByPath(c.path);
          if (file) void this.pullNote(file);
          notice.hide();
        };
        this.refreshBanners();
      }
    );
  }
  /* ---------------------------------------------------------------- */
  /* Send / pull / release                                             */
  /* ---------------------------------------------------------------- */
  splitFrontmatter(raw) {
    const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
    return m ? { fm: m[0], body: raw.slice(m[0].length) } : { fm: "", body: raw };
  }
  async sendNote(file) {
    try {
      const store = this.store();
      const check = store.verify();
      if (!check.ok) {
        new import_obsidian.Notice(`reMarkable bridge: ${check.reason}`, 1e4);
        return;
      }
      const raw = await this.app.vault.read(file);
      const { body } = this.splitFrontmatter(raw);
      const { paragraphs, stash } = markdownToDevice(body, this.settings.appendCheatSheet);
      const folderId = store.ensureFolder(this.settings.deviceFolder);
      const docId = store.createTextDocument(file.basename, folderId, [paragraphs]);
      this.settings.checkouts[docId] = { docId, path: file.path, stash, sentAt: Date.now() };
      await this.saveData(this.settings);
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[FM_ID] = docId;
      });
      this.startWatcher();
      this.refreshBanners();
      new import_obsidian.Notice(`Sent "${file.basename}" to reMarkable (${this.settings.deviceFolder} folder). It will appear after the app syncs.`);
    } catch (e) {
      new import_obsidian.Notice(`Send failed: ${e instanceof Error ? e.message : e}`, 1e4);
      if (!(e instanceof StoreError)) console.error(e);
    }
  }
  async pullNote(file) {
    const checkout = this.checkoutForFile(file);
    if (!checkout) return;
    try {
      const store = this.store();
      if (!store.docExists(checkout.docId)) {
        new import_obsidian.Notice("The reMarkable copy no longer exists. Use force release to unlock the note.", 1e4);
        return;
      }
      const { pages } = store.readTextDocument(checkout.docId);
      const paragraphs = [];
      pages.forEach((p, i) => {
        if (i > 0) paragraphs.push({ style: 1, spans: [] });
        paragraphs.push(...p.paragraphs);
      });
      const warnings = pages.flatMap((p) => p.warnings);
      if (pages.some((p) => p.hasStrokes)) {
        warnings.push("The device copy contains pen strokes; only typed text was pulled.");
      }
      const { markdown, warnings: pullWarnings } = deviceToMarkdown(paragraphs, checkout.stash);
      warnings.push(...pullWarnings);
      const raw = await this.app.vault.read(file);
      const { fm } = this.splitFrontmatter(raw);
      await this.app.vault.modify(file, fm + markdown);
      await this.app.fileManager.processFrontMatter(file, (front) => {
        delete front[FM_ID];
      });
      if (this.settings.trashAfterPull) store.trashDocument(checkout.docId);
      delete this.settings.checkouts[checkout.docId];
      this.changedDocs.delete(checkout.docId);
      await this.saveData(this.settings);
      this.refreshBanners();
      new import_obsidian.Notice(`Pulled "${file.basename}" back from reMarkable.`);
      for (const w of warnings) new import_obsidian.Notice(`reMarkable bridge: ${w}`, 1e4);
    } catch (e) {
      new import_obsidian.Notice(`Pull failed: ${e instanceof Error ? e.message : e}`, 1e4);
      console.error(e);
    }
  }
  async forceRelease(file) {
    const checkout = this.checkoutForFile(file);
    if (!checkout) return;
    const store = this.store();
    if (store.docExists(checkout.docId)) {
      try {
        store.trashDocument(checkout.docId);
      } catch (e) {
        console.error(e);
      }
    }
    delete this.settings.checkouts[checkout.docId];
    this.changedDocs.delete(checkout.docId);
    await this.saveData(this.settings);
    await this.app.fileManager.processFrontMatter(file, (front) => {
      delete front[FM_ID];
    });
    this.refreshBanners();
    new import_obsidian.Notice(`Released "${file.basename}". The device copy was moved to the reMarkable trash.`);
  }
  /* ---------------------------------------------------------------- */
  /* Banner                                                            */
  /* ---------------------------------------------------------------- */
  refreshBanners() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian.MarkdownView)) continue;
      view.containerEl.querySelector(".rm-bridge-banner")?.remove();
      const file = view.file;
      if (!file) continue;
      const checkout = this.checkoutForFile(file);
      if (!checkout) continue;
      const banner = createDiv({ cls: "rm-bridge-banner" });
      const sent = new Date(checkout.sentAt);
      const hasChanges = this.changedDocs.has(checkout.docId);
      banner.createSpan({
        text: hasChanges ? "Edited on your reMarkable; changes are ready. " : `On your reMarkable since ${sent.toLocaleString()}. ${this.settings.lockWhileOut ? "Read-only here. " : ""}`
      });
      const pull = banner.createEl("button", { text: "Pull back" });
      pull.onclick = () => void this.pullNote(file);
      const release = banner.createEl("button", { text: "Force release" });
      release.onclick = () => void this.forceRelease(file);
      const header = view.containerEl.querySelector(".view-header");
      header?.insertAdjacentElement("afterend", banner);
    }
  }
};
var BridgeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const store = this.plugin.store();
    const check = store.verify();
    new import_obsidian.Setting(containerEl).setName("Desktop app store").setDesc(
      check.ok ? `Connected: ${check.documents} documents at ${store.root}` : `Not connected: ${check.reason}`
    ).addText(
      (text) => text.setPlaceholder(defaultStorePath()).setValue(this.plugin.settings.storePath).onChange(async (value) => {
        this.plugin.settings.storePath = value.trim();
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Device folder").setDesc("Folder on the reMarkable where sent notes appear.").addText(
      (text) => text.setValue(this.plugin.settings.deviceFolder).onChange(async (value) => {
        this.plugin.settings.deviceFolder = value.trim() || "Obsidian";
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Archive device copy after pull").setDesc("Moves the reMarkable copy to the device trash once pulled back, keeping you under the free tier's document sync limit.").addToggle(
      (t) => t.setValue(this.plugin.settings.trashAfterPull).onChange(async (v) => {
        this.plugin.settings.trashAfterPull = v;
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Lock notes while checked out").setDesc("Prevents edits in Obsidian while a note is on the reMarkable, so the two copies can't diverge.").addToggle(
      (t) => t.setValue(this.plugin.settings.lockWhileOut).onChange(async (v) => {
        this.plugin.settings.lockWhileOut = v;
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Append syntax cheat sheet").setDesc("Adds a short reference for footnote and comment syntax at the end of each sent note. Never copied back.").addToggle(
      (t) => t.setValue(this.plugin.settings.appendCheatSheet).onChange(async (v) => {
        this.plugin.settings.appendCheatSheet = v;
        await this.plugin.saveData(this.plugin.settings);
      })
    );
    const out = Object.values(this.plugin.settings.checkouts);
    if (out.length) {
      new import_obsidian.Setting(containerEl).setName("Checked out to the reMarkable").setHeading();
      for (const c of out) {
        new import_obsidian.Setting(containerEl).setName(c.path).setDesc(`Sent ${new Date(c.sentAt).toLocaleString()}`);
      }
    }
  }
};
