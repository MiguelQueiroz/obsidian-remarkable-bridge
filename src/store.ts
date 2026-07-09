/*
 * Bridge to the reMarkable desktop app's local document store.
 *
 * The store is the app's own working copy of the tablet's library (xochitl
 * layout: per-document UUID folders of .rm pages plus sidecar JSON files).
 * We create fresh documents and read existing ones; we never rewrite a page
 * file in place and never delete anything. The official app syncs.
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

export interface DocMetadata {
  visibleName: string;
  parent: string;
  type: "DocumentType" | "CollectionType";
  lastModified: string;
  deleted?: boolean;
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

export class RemarkableStore {
  constructor(public readonly root: string) {}

  /** Sanity-check the layout before touching anything. */
  verify(): { ok: boolean; documents: number; reason?: string } {
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

  readMetadata(docId: string): DocMetadata {
    return JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.metadata`), "utf8"));
  }

  private writeMetadata(docId: string, meta: DocMetadata & Record<string, unknown>) {
    fs.writeFileSync(path.join(this.root, `${docId}.metadata`), JSON.stringify(meta, null, 4));
  }

  /** Find a folder by name at the root level, or create it. Returns its id. */
  ensureFolder(name: string): string {
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
    const id = randomUUID();
    const now = String(Date.now());
    this.writeMetadata(id, {
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
    fs.writeFileSync(path.join(this.root, `${id}.content`), JSON.stringify({ tags: [] }, null, 4));
    return id;
  }

  /** Create a fresh typed-text document. Returns the new document id. */
  createTextDocument(name: string, parentId: string, pages: OutParagraph[][]): string {
    const check = this.verify();
    if (!check.ok) throw new StoreError(check.reason);

    const docId = randomUUID();
    const authorUuid = randomUUID();
    const docDir = path.join(this.root, docId);
    fs.mkdirSync(docDir);

    const pageIds: string[] = [];
    for (const paragraphs of pages) {
      const pageId = randomUUID();
      pageIds.push(pageId);
      fs.writeFileSync(path.join(docDir, `${pageId}.rm`), buildTextPage(paragraphs, authorUuid));
    }

    // Page index values sort lexicographically: "aa", "ab", ...
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
      visibleName: name,
    } as DocMetadata & Record<string, unknown>);
    return docId;
  }

  docExists(docId: string): boolean {
    return fs.existsSync(path.join(this.root, `${docId}.metadata`));
  }

  /** List documents (not folders) in the store, newest first. */
  listDocuments(): { id: string; name: string; parent: string; lastModified: number; fileType: string }[] {
    const docs: { id: string; name: string; parent: string; lastModified: number; fileType: string }[] = [];
    for (const f of fs.readdirSync(this.root)) {
      if (!f.endsWith(".metadata")) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.root, f), "utf8"));
        if (meta.type !== "DocumentType" || meta.deleted || meta.parent === "trash") continue;
        const id = f.slice(0, -".metadata".length);
        let fileType = "notebook";
        try {
          fileType = JSON.parse(fs.readFileSync(path.join(this.root, `${id}.content`), "utf8")).fileType ?? "notebook";
        } catch {
          // Missing content file; treat as notebook.
        }
        docs.push({
          id,
          name: meta.visibleName,
          parent: meta.parent ?? "",
          lastModified: parseInt(meta.lastModified, 10) || 0,
          fileType,
        });
      } catch {
        continue;
      }
    }
    return docs.sort((a, b) => b.lastModified - a.lastModified);
  }

  /** Create a PDF document on the device from raw bytes. */
  createPdfDocument(name: string, parentId: string, pdf: Uint8Array, pageCount: number): string {
    const check = this.verify();
    if (!check.ok) throw new StoreError(check.reason);

    const docId = randomUUID();
    fs.mkdirSync(path.join(this.root, docId));
    fs.writeFileSync(path.join(this.root, `${docId}.pdf`), pdf);

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
    const now = String(Date.now());
    fs.writeFileSync(path.join(this.root, `${docId}.content`), JSON.stringify(content, null, 4));
    fs.writeFileSync(path.join(this.root, `${docId}.local`), JSON.stringify({ contentFormatVersion: 1 }, null, 4));
    fs.writeFileSync(path.join(this.root, `${docId}.pagedata`), "Blank\n".repeat(pageCount));
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
      visibleName: name,
    } as DocMetadata & Record<string, unknown>);
    return docId;
  }

  readPdfBytes(docId: string): Uint8Array | null {
    const p = path.join(this.root, `${docId}.pdf`);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }

  /** Page ids in order with their base-PDF page index (or null if inserted). */
  private pageMap(docId: string): { pageId: string; pdfPageIndex: number | null }[] {
    const content = JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.content`), "utf8"));
    if (content.cPages?.pages) {
      return content.cPages.pages.map((p: { id: string; redir?: { value: number } }, i: number) => ({
        pageId: p.id,
        pdfPageIndex: p.redir ? p.redir.value : i,
      }));
    }
    const pages: string[] = content.pages ?? [];
    const redirect: number[] = content.redirectionPageMap ?? pages.map((_, i) => i);
    return pages.map((pageId, i) => ({
      pageId,
      pdfPageIndex: redirect[i] >= 0 ? redirect[i] : null,
    }));
  }

  /** Extract ink strokes per base-PDF page, for baking into the PDF. */
  readInk(docId: string): { ink: PageInk[]; skippedPages: number } {
    const ink: PageInk[] = [];
    let skippedPages = 0;
    for (const { pageId, pdfPageIndex } of this.pageMap(docId)) {
      const rmPath = path.join(this.root, docId, `${pageId}.rm`);
      if (!fs.existsSync(rmPath)) continue;
      try {
        const buf = fs.readFileSync(rmPath);
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
  readHighlights(docId: string): { page: number; highlights: Highlight[] }[] {
    const content = JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.content`), "utf8"));
    const pageIds: string[] =
      content.cPages?.pages?.map((p: { id: string }) => p.id) ?? content.pages ?? [];
    const redirect: number[] | undefined = content.redirectionPageMap;
    const out: { page: number; highlights: Highlight[] }[] = [];
    pageIds.forEach((pid, i) => {
      const rmPath = path.join(this.root, docId, `${pid}.rm`);
      if (!fs.existsSync(rmPath)) return;
      try {
        const highlights = parseHighlights(fs.readFileSync(rmPath));
        if (highlights.length) out.push({ page: (redirect?.[i] ?? i) + 1, highlights });
      } catch {
        // Ignore unreadable pages; highlights are best-effort.
      }
    });
    return out;
  }

  /** Resolve a folder id to its visible name ("" for the root). */
  folderName(folderId: string): string {
    if (!folderId) return "";
    try {
      return this.readMetadata(folderId).visibleName;
    } catch {
      return "?";
    }
  }

  /** Read all pages of a document, in page order. */
  readTextDocument(docId: string): { pages: ParsedPage[]; lastModified: string } {
    const meta = this.readMetadata(docId);
    const content = JSON.parse(fs.readFileSync(path.join(this.root, `${docId}.content`), "utf8"));
    const pageEntries: { id: string }[] = content.cPages?.pages ?? [];
    const pages: ParsedPage[] = [];
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
  trashDocument(docId: string) {
    const meta = this.readMetadata(docId) as DocMetadata & Record<string, unknown>;
    meta.parent = "trash";
    meta.lastModified = String(Date.now());
    meta.metadatamodified = true;
    this.writeMetadata(docId, meta);
  }

  /**
   * Watch tracked documents for changes arriving from the device.
   * Returns a dispose function.
   */
  watch(docIds: () => Set<string>, onChange: (docId: string) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const docId = String(filename).split(path.sep)[0].replace(/\.(metadata|content|local|pagedata)$/, "");
        if (!docIds().has(docId)) return;
        pending.add(docId);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          for (const id of pending) onChange(id);
          pending.clear();
        }, 2000);
      });
    } catch {
      return () => {};
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }
}
