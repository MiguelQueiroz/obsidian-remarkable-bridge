import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  editorInfoField,
} from "obsidian";
import { EditorState } from "@codemirror/state";
import { RemarkableStore, defaultStorePath, StoreError } from "./store";
import { markdownToDevice, deviceToMarkdown } from "./academic";
import { ParsedParagraph } from "./rm/codec";

interface Checkout {
  docId: string;
  path: string;
  stash: string[];
  sentAt: number;
}

interface BridgeSettings {
  storePath: string;
  deviceFolder: string;
  trashAfterPull: boolean;
  lockWhileOut: boolean;
  appendCheatSheet: boolean;
  checkouts: Record<string, Checkout>;
}

const DEFAULT_SETTINGS: BridgeSettings = {
  storePath: "",
  deviceFolder: "Obsidian",
  trashAfterPull: true,
  lockWhileOut: true,
  appendCheatSheet: true,
  checkouts: {},
};

const FM_ID = "remarkable-id";

export default class RemarkableBridge extends Plugin {
  settings: BridgeSettings = DEFAULT_SETTINGS;
  private stopWatch: (() => void) | null = null;
  private changedDocs = new Set<string>();

  store(): RemarkableStore {
    return new RemarkableStore(this.settings.storePath || defaultStorePath());
  }

  checkoutForFile(file: TFile): Checkout | undefined {
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
      },
    });

    this.addCommand({
      id: "pull-from-remarkable",
      name: "Pull note back from reMarkable",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.checkoutForFile(file)) return false;
        if (!checking) void this.pullNote(file);
        return true;
      },
    });

    this.addCommand({
      id: "force-release",
      name: "Force release (discard reMarkable copy)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.checkoutForFile(file)) return false;
        if (!checking) void this.forceRelease(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const out = this.checkoutForFile(file);
        menu.addItem((item) =>
          item
            .setTitle(out ? "Pull back from reMarkable" : "Send to reMarkable")
            .setIcon("tablet")
            .onClick(() => (out ? this.pullNote(file) : this.sendNote(file)))
        );
      })
    );

    // Block edits to checked-out notes.
    this.registerEditorExtension(
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || !this.settings.lockWhileOut) return tr;
        const info = tr.startState.field(editorInfoField, false);
        const file = info?.file;
        if (file && this.checkoutForFile(file)) {
          new Notice("This note is on your reMarkable. Pull it back to edit here.");
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

  private startWatcher() {
    this.stopWatch?.();
    this.stopWatch = this.store().watch(
      () => new Set(Object.keys(this.settings.checkouts)),
      (docId) => {
        if (this.changedDocs.has(docId)) return;
        this.changedDocs.add(docId);
        const c = this.settings.checkouts[docId];
        if (!c) return;
        const name = c.path.split("/").pop();
        const notice = new Notice("", 30000);
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

  private splitFrontmatter(raw: string): { fm: string; body: string } {
    const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
    return m ? { fm: m[0], body: raw.slice(m[0].length) } : { fm: "", body: raw };
  }

  async sendNote(file: TFile) {
    try {
      const store = this.store();
      const check = store.verify();
      if (!check.ok) {
        new Notice(`reMarkable bridge: ${check.reason}`, 10000);
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
      new Notice(`Sent "${file.basename}" to reMarkable (${this.settings.deviceFolder} folder). It will appear after the app syncs.`);
    } catch (e) {
      new Notice(`Send failed: ${e instanceof Error ? e.message : e}`, 10000);
      if (!(e instanceof StoreError)) console.error(e);
    }
  }

  async pullNote(file: TFile) {
    const checkout = this.checkoutForFile(file);
    if (!checkout) return;
    try {
      const store = this.store();
      if (!store.docExists(checkout.docId)) {
        new Notice("The reMarkable copy no longer exists. Use force release to unlock the note.", 10000);
        return;
      }
      const { pages } = store.readTextDocument(checkout.docId);
      const paragraphs: ParsedParagraph[] = [];
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

      new Notice(`Pulled "${file.basename}" back from reMarkable.`);
      for (const w of warnings) new Notice(`reMarkable bridge: ${w}`, 10000);
    } catch (e) {
      new Notice(`Pull failed: ${e instanceof Error ? e.message : e}`, 10000);
      console.error(e);
    }
  }

  async forceRelease(file: TFile) {
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
    new Notice(`Released "${file.basename}". The device copy was moved to the reMarkable trash.`);
  }

  /* ---------------------------------------------------------------- */
  /* Banner                                                            */
  /* ---------------------------------------------------------------- */

  refreshBanners() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      view.containerEl.querySelector(".rm-bridge-banner")?.remove();
      const file = view.file;
      if (!file) continue;
      const checkout = this.checkoutForFile(file);
      if (!checkout) continue;

      const banner = createDiv({ cls: "rm-bridge-banner" });
      const sent = new Date(checkout.sentAt);
      const hasChanges = this.changedDocs.has(checkout.docId);
      banner.createSpan({
        text: hasChanges
          ? "Edited on your reMarkable; changes are ready. "
          : `On your reMarkable since ${sent.toLocaleString()}. ${this.settings.lockWhileOut ? "Read-only here. " : ""}`,
      });
      const pull = banner.createEl("button", { text: "Pull back" });
      pull.onclick = () => void this.pullNote(file);
      const release = banner.createEl("button", { text: "Force release" });
      release.onclick = () => void this.forceRelease(file);

      const header = view.containerEl.querySelector(".view-header");
      header?.insertAdjacentElement("afterend", banner);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: RemarkableBridge) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const store = this.plugin.store();
    const check = store.verify();
    new Setting(containerEl)
      .setName("Desktop app store")
      .setDesc(
        check.ok
          ? `Connected: ${check.documents} documents at ${store.root}`
          : `Not connected: ${check.reason}`
      )
      .addText((text) =>
        text
          .setPlaceholder(defaultStorePath())
          .setValue(this.plugin.settings.storePath)
          .onChange(async (value) => {
            this.plugin.settings.storePath = value.trim();
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName("Device folder")
      .setDesc("Folder on the reMarkable where sent notes appear.")
      .addText((text) =>
        text.setValue(this.plugin.settings.deviceFolder).onChange(async (value) => {
          this.plugin.settings.deviceFolder = value.trim() || "Obsidian";
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Archive device copy after pull")
      .setDesc("Moves the reMarkable copy to the device trash once pulled back, keeping you under the free tier's document sync limit.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.trashAfterPull).onChange(async (v) => {
          this.plugin.settings.trashAfterPull = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Lock notes while checked out")
      .setDesc("Prevents edits in Obsidian while a note is on the reMarkable, so the two copies can't diverge.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.lockWhileOut).onChange(async (v) => {
          this.plugin.settings.lockWhileOut = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Append syntax cheat sheet")
      .setDesc("Adds a short reference for footnote and comment syntax at the end of each sent note. Never copied back.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.appendCheatSheet).onChange(async (v) => {
          this.plugin.settings.appendCheatSheet = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    const out = Object.values(this.plugin.settings.checkouts);
    if (out.length) {
      new Setting(containerEl).setName("Checked out to the reMarkable").setHeading();
      for (const c of out) {
        new Setting(containerEl)
          .setName(c.path)
          .setDesc(`Sent ${new Date(c.sentAt).toLocaleString()}`);
      }
    }
  }
}
