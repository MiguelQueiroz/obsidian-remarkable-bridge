/* Exercise the real send pipeline: create a footnote demo document in the
 * actual desktop store, then verify the pull pipeline reads it back. */
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const { RemarkableStore, defaultStorePath } = await import(join(here, "build", "store.js"));
const academic = await import(join(here, "build", "academic.js"));

const md = [
  "# Footnote demo",
  "",
  "This note was sent by the Obsidian plugin pipeline. It has a footnote already.[^a]",
  "",
  "Try the workflow with the Folio:",
  "- Edit the [1] line under Notes below",
  "- Add a new footnote anywhere by typing ((your note text))",
  "- Then pull the note back in Obsidian",
  "",
  "[^a]: An original footnote, editable under Notes below.",
].join("\n");

const store = new RemarkableStore(process.env.RM_STORE ?? defaultStorePath());
const check = await store.verify();
if (!check.ok) {
  console.error(`store check failed: ${check.reason}`);
  process.exit(1);
}
console.log(`store OK (${check.documents} documents)`);

const { paragraphs, stash } = academic.markdownToDevice(md, true);
const folderId = await store.ensureFolder("Obsidian");
console.log(`folder "Obsidian": ${folderId}`);
const docId = await store.createTextDocument("Footnote demo", folderId, [paragraphs]);
console.log(`created document: ${docId}`);

const { pages } = await store.readTextDocument(docId);
const pulled = academic.deviceToMarkdown(pages[0].paragraphs, stash);
const ok =
  pulled.markdown.includes("footnote already.[^1]") &&
  pulled.markdown.includes("[^1]: An original footnote") &&
  !pulled.markdown.includes("cheat sheet");
console.log(`pull pipeline reads it back: ${ok ? "OK" : "MISMATCH"}`);
if (!ok) {
  console.log(pulled.markdown);
  console.log(pulled.warnings);
  process.exit(1);
}
