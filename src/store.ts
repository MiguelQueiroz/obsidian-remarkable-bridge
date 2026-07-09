/*
 * Bridge to the reMarkable desktop app's local document store.
 *
 * The store is the app's own working copy of the tablet's library (xochitl
 * layout: per-document UUID folders of .rm pages plus sidecar JSON files).
 * We create fresh documents and read existing ones; we never rewrite a page
 * file in place and never delete anything. The official app syncs.
 *
 * All I/O is asynchronous: while the app is syncing, reads on this directory
 * can take tens of milliseconds each, and blocking the UI thread with
 * hundreds of them freezes Obsidian. Library listings are cached briefly.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import {
  buildTextPage,
  parsePage,
  parseHighlights,
  parseStrokes,
  parsePaperSize,
  Highlight,
  OutParagraph,
  ParsedPage,
} from "./rm/codec";
import { PageInk } from "./pdf-ink";

const fsp = fs.promises;

export interface DocMetadata {
  visibleName: string;
  parent: string;
  type: "DocumentType" | "CollectionType";
  lastModified: string;
  deleted?: boolean;
}

export interface DocInfo {
  id: string;
  name: string;
  parent: string;
  lastModified: number;
  fileType: string;
}

export interface StoreSnapshot {
  docs: DocInfo[];
  folders: Map<string, string>;
  documents: number;
}

export class StoreError extends Error {}

export function defaultStorePath(): string {
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

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class RemarkableStore {
  private snapshotCache: { at: number; promise: Promise<StoreSnapshot> } | null = null;

  constructor(public readonly root: string) {}

  /** Sanity-check the layout before touching anything. */
  async verify(): Promise<{ ok: boolean; documents: number; reason?: string }> {
    try {
      await fsp.access(this.root);
    } catch {
      return { ok: false, documents: 0, reason: `Store not found at ${this.root}. Is the reMarkable desktop app installed?` };
    }
    const metas = (await fsp.readdir(this.root)).filter((f) => f.endsWith(".metadata"));
    if (metas.length === 0) {
      return { ok: false, documents: 0, reason: "Store contains no documents; open the reMarkable desktop app once first." };
    }
    const sample = await readJson(path.join(this.root, metas[0]));
    if (!sample || typeof sample.visibleName !== "string" || typeof sample.type !== "string") {
      return { ok: false, documents: metas.length, reason: "Store layout not recognized (app update?). Refusing to write." };
    }
    return { ok: true, documents: metas.length };
  }

  private async readMetadata(docId: string): Promise<DocMetadata> {
    const meta = await readJson(path.join(this.root, `${docId}.metadata`));
    if (!meta) throw new StoreError(`Cannot read metadata for ${docId}`);
    return meta as unknown as DocMetadata;
  }

  private async writeMetadata(docId: string, meta: DocMetadata & Record<string, unknown>) {
    await fsp.writeFile(path.join(this.root, `${docId}.metadata`), JSON.stringify(meta, null, 4));
  }

  /**
   * One pass over the library: all documents plus a folder-name map.
   * Cached for 60 seconds; concurrent callers share one scan.
   *
   * Concurrency stays at 2: node gives the whole renderer one small I/O
   * thread pool, and while the reMarkable app is syncing, reads on the store
   * can be very slow. Saturating the pool starves every other plugin's (and
   * Obsidian's own) file access.
   */
  snapshot(): Promise<StoreSnapshot> {
    if (this.snapshotCache && Date.now() - this.snapshotCache.at < 60_000) {
      return this.snapshotCache.promise;
    }
    const promise = this.buildSnapshot();
    this.snapshotCache = { at: Date.now(), promise };
    promise.catch(() => (this.snapshotCache = null));
    return promise;
  }

  invalidate() {
    this.snapshotCache = null;
  }

  private async mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  private async buildSnapshot(): Promise<StoreSnapshot> {
    const entries = await fsp.readdir(this.root);
    const metaFiles = entries.filter((f) => f.endsWith(".metadata"));
    const present = new Set(entries);
    const docs: DocInfo[] = [];
    const folders = new Map<string, string>();

    await this.mapLimited(metaFiles, 2, async (f) => {
      const meta = (await readJson(path.join(this.root, f))) as (DocMetadata & Record<string, unknown>) | null;
      if (!meta) return;
      const id = f.slice(0, -".metadata".length);
      if (meta.type === "CollectionType" && !meta.deleted) {
        folders.set(id, meta.visibleName);
        return;
      }
      if (meta.type !== "DocumentType" || meta.deleted || meta.parent === "trash") return;
      // File type from sidecar presence: avoids a second read per document.
      const fileType = present.has(`${id}.pdf`) ? "pdf" : present.has(`${id}.epub`) ? "epub" : "notebook";
      docs.push({
        id,
        name: meta.visibleName,
        parent: meta.parent ?? "",
        lastModified: parseInt(meta.lastModified, 10) || 0,
        fileType,
      });
    });

    docs.sort((a, b) => b.lastModified - a.lastModified);
    return { docs, folders, documents: metaFiles.length };
  }

  /** Find a folder by name at the root level, or create it. Returns its id. */
  async ensureFolder(name: string): Promise<string> {
    const snap = await this.snapshot();
    for (const [id, folderName] of snap.folders) {
      const meta = await this.readMetadata(id).catch(() => null);
      if (folderName === name && meta && meta.parent === "" && !meta.deleted) return id;
    }
    const id = randomUUID();
    const now = String(Date.now());
    await this.writeMetadata(id, {
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
      visibleName: name,
    });
    await fsp.writeFile(path.join(this.root, `${id}.content`), JSON.stringify({ tags: [] }, null, 4));
    this.invalidate();
    return id;
  }

  private baseMetadata(name: string, parentId: string): DocMetadata & Record<string, unknown> {
    const now = String(Date.now());
    return {
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
      visibleName: name,
    };
  }

  /** Create a fresh typed-text document. Returns the new document id. */
  async createTextDocument(name: string, parentId: string, pages: OutParagraph[][]): Promise<string> {
    const check = await this.verify();
    if (!check.ok) throw new StoreError(check.reason);

    const docId = randomUUID();
    const authorUuid = randomUUID();
    const docDir = path.join(this.root, docId);
    await fsp.mkdir(docDir);

    const pageIds: string[] = [];
    for (const paragraphs of pages) {
      const pageId = randomUUID();
      pageIds.push(pageId);
      await fsp.writeFile(path.join(docDir, `${pageId}.rm`), buildTextPage(paragraphs, authorUuid));
    }

    const idx = (i: number) => `a${String.fromCharCode(97 + i)}`;
    const content = {
      cPages: {
        lastOpened: { timestamp: "0:0", value: pageIds[0] },
        original: { timestamp: "0:0", value: 0 },
        pages: pageIds.map((pid, i) => ({ id: pid, idx: { timestamp: "0:1", value: idx(i) } })),
        uuids: [],
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
      zoomMode: "bestFit",
    };
    await fsp.writeFile(path.join(this.root, `${docId}.content`), JSON.stringify(content, null, 4));
    await fsp.writeFile(path.join(this.root, `${docId}.local`), JSON.stringify({ contentFormatVersion: 2 }, null, 4));
    await fsp.writeFile(path.join(this.root, `${docId}.pagedata`), "Blank\n".repeat(pageIds.length));
    await this.writeMetadata(docId, this.baseMetadata(name, parentId));
    this.invalidate();
    return docId;
  }

  /** Create a PDF document on the device from raw bytes. */
  async createPdfDocument(name: string, parentId: string, pdf: Uint8Array, pageCount: number): Promise<string> {
    const check = await this.verify();
    if (!check.ok) throw new StoreError(check.reason);

    const docId = randomUUID();
    await fsp.mkdir(path.join(this.root, docId));
    await fsp.writeFile(path.join(this.root, `${docId}.pdf`), pdf);

    const pageIds = Array.from({ length: pageCount }, () => randomUUID());
    const content = {
      coverPageNumber: -1,
      documentMetadata: {},
      dummyDocument: false,
      extraMetadata: {},
      fileType: "pdf",
      fontName: "",
      formatVersion: 1,
      lastOpenedPage: 0,
      lineHeight: -1,
      margins: 180,
      orientation: "portrait",
      originalPageCount: pageCount,
      pageCount,
      pageTags: [],
      pages: pageIds,
      redirectionPageMap: Array.from({ length: pageCount }, (_, i) => i),
      sizeInBytes: String(pdf.length),
      tags: [],
      textAlignment: "justify",
      textScale: 1,
      zoomMode: "bestFit",
    };
    await fsp.writeFile(path.join(this.root, `${docId}.content`), JSON.stringify(content, null, 4));
    await fsp.writeFile(path.join(this.root, `${docId}.local`), JSON.stringify({ contentFormatVersion: 1 }, null, 4));
    await fsp.writeFile(path.join(this.root, `${docId}.pagedata`), "Blank\n".repeat(pageCount));
    await this.writeMetadata(docId, this.baseMetadata(name, parentId));
    this.invalidate();
    return docId;
  }

  async docExists(docId: string): Promise<boolean> {
    try {
      await fsp.access(path.join(this.root, `${docId}.metadata`));
      return true;
    } catch {
      return false;
    }
  }

  async readPdfBytes(docId: string): Promise<Uint8Array | null> {
    try {
      return await fsp.readFile(path.join(this.root, `${docId}.pdf`));
    } catch {
      return null;
    }
  }

  /** Page ids in order with their base-PDF page index (or null if inserted). */
  private async pageMap(docId: string): Promise<{ pageId: string; pdfPageIndex: number | null }[]> {
    const content = await readJson(path.join(this.root, `${docId}.content`));
    if (!content) throw new StoreError(`Cannot read content for ${docId}`);
    const cPages = content.cPages as { pages?: { id: string; redir?: { value: number } }[] } | undefined;
    if (cPages?.pages) {
      return cPages.pages.map((p, i) => ({ pageId: p.id, pdfPageIndex: p.redir ? p.redir.value : i }));
    }
    const pages = (content.pages as string[]) ?? [];
    const redirect = (content.redirectionPageMap as number[]) ?? pages.map((_, i) => i);
    return pages.map((pageId, i) => ({ pageId, pdfPageIndex: redirect[i] >= 0 ? redirect[i] : null }));
  }

  /** Read all pages of a document, in page order. */
  async readTextDocument(docId: string): Promise<{ pages: ParsedPage[]; lastModified: string }> {
    const meta = await this.readMetadata(docId);
    const pages: ParsedPage[] = [];
    for (const { pageId } of await this.pageMap(docId)) {
      try {
        pages.push(parsePage(await fsp.readFile(path.join(this.root, docId, `${pageId}.rm`))));
      } catch (e) {
        pages.push({ paragraphs: [], hasStrokes: false, warnings: [`Missing or unreadable page ${pageId}: ${e}`] });
      }
    }
    return { pages, lastModified: meta.lastModified };
  }

  /** Extract ink strokes per base-PDF page, for baking into the PDF. */
  async readInk(docId: string): Promise<{ ink: PageInk[]; skippedPages: number }> {
    const ink: PageInk[] = [];
    let skippedPages = 0;
    for (const { pageId, pdfPageIndex } of await this.pageMap(docId)) {
      let buf: Uint8Array;
      try {
        buf = await fsp.readFile(path.join(this.root, docId, `${pageId}.rm`));
      } catch {
        continue;
      }
      try {
        const strokes = parseStrokes(buf);
        if (!strokes.length) continue;
        if (pdfPageIndex === null) {
          skippedPages++;
          continue;
        }
        ink.push({ pdfPageIndex, strokes, paperSize: parsePaperSize(buf) });
      } catch {
        continue;
      }
    }
    return { ink, skippedPages };
  }

  /** Extract smart highlights per page, in page order (1-based page numbers). */
  async readHighlights(docId: string): Promise<{ page: number; highlights: Highlight[] }[]> {
    const out: { page: number; highlights: Highlight[] }[] = [];
    const map = await this.pageMap(docId);
    for (let i = 0; i < map.length; i++) {
      const { pageId, pdfPageIndex } = map[i];
      let buf: Uint8Array;
      try {
        buf = await fsp.readFile(path.join(this.root, docId, `${pageId}.rm`));
      } catch {
        continue;
      }
      try {
        const highlights = parseHighlights(buf);
        if (highlights.length) out.push({ page: (pdfPageIndex ?? i) + 1, highlights });
      } catch {
        continue;
      }
    }
    return out;
  }

  /** Move a document to the device trash (never hard-delete). */
  async trashDocument(docId: string) {
    const meta = (await this.readMetadata(docId)) as DocMetadata & Record<string, unknown>;
    meta.parent = "trash";
    meta.lastModified = String(Date.now());
    meta.metadatamodified = true;
    await this.writeMetadata(docId, meta);
    this.invalidate();
  }

  /**
   * Watch tracked documents for changes arriving from the device.
   * Returns a dispose function.
   */
  watch(docIds: () => Set<string>, onChange: (docId: string) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    let watcher: fs.FSWatcher | null = null;
    // The store sees heavy event churn during app sync; cache the tracked-id
    // set briefly so we don't rebuild it for every single event.
    let cachedIds: Set<string> | null = null;
    let cachedAt = 0;
    const tracked = () => {
      const now = Date.now();
      if (!cachedIds || now - cachedAt > 5000) {
        cachedIds = docIds();
        cachedAt = now;
      }
      return cachedIds;
    };
    try {
      // During a full app resync this fires thousands of times per second on
      // the main thread, so the per-event path must be a slice and a Set
      // lookup, nothing more. Document ids are always the first 36 chars of
      // the path ("<uuid>.metadata", "<uuid>/<page>.rm").
      watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const docId = String(filename).slice(0, 36);
        if (!tracked().has(docId)) return;
        pending.add(docId);
        if (timer === null) {
          timer = window.setTimeout(() => {
            timer = null;
            for (const id of pending) onChange(id);
            pending.clear();
          }, 2000);
        }
      });
    } catch {
      return () => {};
    }
    return () => {
      if (timer) window.clearTimeout(timer);
      watcher?.close();
    };
  }
}
