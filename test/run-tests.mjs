/* Cross-check the TS codec against rmscene and round-trip generated pages. */
import { execFileSync } from "child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { homedir, tmpdir } from "os";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const codec = await import(join(here, "build", "rm", "codec.js"));

const PYTHON = process.env.RMSCENE_PYTHON;
const STORE = join(
  homedir(),
  "Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop"
);

let failures = 0;
let checks = 0;
const assert = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
};

const paraText = (paragraphs) => paragraphs.map((p) => p.spans.map((s) => s.text).join("")).join("\n");

/* 1. Parse every .rm file in the store without crashing; count text pages. */
const rmFiles = [];
for (const entry of readdirSync(STORE)) {
  const dir = join(STORE, entry);
  if (!entry.match(/^[0-9a-f-]{36}$/) || !statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith(".rm")) rmFiles.push(join(dir, f));
}
let textPages = 0;
let parseErrors = 0;
for (const f of rmFiles) {
  try {
    const page = codec.parsePage(readFileSync(f));
    if (paraText(page.paragraphs).trim()) textPages++;
  } catch (e) {
    parseErrors++;
    console.error(`parse error in ${f}: ${e.message}`);
  }
}
console.log(`parsed ${rmFiles.length} pages from store: ${textPages} with text, ${parseErrors} errors`);
assert(parseErrors === 0, "some store pages failed to parse");
assert(textPages > 0, "expected at least one page with typed text");

/* 2. Cross-check extracted text against rmscene on pages with text. */
if (PYTHON) {
  const sample = [];
  for (const f of rmFiles) {
    try {
      if (paraText(codec.parsePage(readFileSync(f)).paragraphs).trim()) sample.push(f);
    } catch {}
    if (sample.length >= 40) break;
  }
  const dumped = JSON.parse(
    execFileSync(PYTHON, [join(here, "dump_rmscene.py"), ...sample], { maxBuffer: 64 * 1024 * 1024 }).toString()
  );
  let matched = 0;
  for (const f of sample) {
    const ours = codec.parsePage(readFileSync(f));
    const theirs = dumped[f];
    assert(!theirs.error, `rmscene failed on ${f}: ${theirs.error}`);
    if (theirs.error) continue;
    const oursNorm = JSON.stringify(
      ours.paragraphs.map((p) => ({ style: p.style, spans: p.spans.filter((s) => s.text) }))
    );
    const theirsNorm = JSON.stringify(
      theirs.paragraphs.map((p) => ({ style: p.style, spans: p.spans }))
    );
    if (oursNorm === theirsNorm) matched++;
    else {
      assert(false, `mismatch vs rmscene on ${f}`);
      console.error(` ours:   ${oursNorm.slice(0, 300)}`);
      console.error(` theirs: ${theirsNorm.slice(0, 300)}`);
    }
  }
  console.log(`rmscene cross-check: ${matched}/${sample.length} pages identical`);
} else {
  console.log("RMSCENE_PYTHON not set; skipping rmscene cross-check");
}

/* 3. Round-trip a generated page through our own parser. */
const P = codec.ParagraphStyle;
const doc = [
  { style: P.HEADING, spans: [{ text: "Techne paper notes" }] },
  { style: P.PLAIN, spans: [{ text: "Plain text with " }, { text: "italic", italic: true }, { text: " and " }, { text: "bold", bold: true }, { text: " spans." }] },
  { style: P.PLAIN, spans: [] },
  { style: P.BULLET, spans: [{ text: "A bullet with a footnote marker [1]" }] },
  { style: P.PLAIN, spans: [{ text: "Unicode: technē, ἀρετή, ⸻ and emoji 🙂" }] },
];
const authorUuid = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const built = codec.buildTextPage(doc, authorUuid);
const reread = codec.parsePage(built);
assert(reread.warnings.length === 0, `round-trip warnings: ${reread.warnings}`);
assert(reread.paragraphs.length === doc.length, `round-trip paragraph count ${reread.paragraphs.length} != ${doc.length}`);
for (let i = 0; i < doc.length; i++) {
  const want = doc[i];
  const got = reread.paragraphs[i];
  assert(got.style === want.style, `p${i} style ${got.style} != ${want.style}`);
  const wantSpans = want.spans.map((s) => ({ text: s.text, bold: !!s.bold, italic: !!s.italic }));
  assert(JSON.stringify(got.spans) === JSON.stringify(wantSpans), `p${i} spans differ: ${JSON.stringify(got.spans)}`);
}
console.log("round-trip of generated page OK");

/* 4. Generated page also parses identically under rmscene. */
if (PYTHON) {
  const tmp = mkdtempSync(join(tmpdir(), "rmbridge-"));
  const tmpFile = join(tmp, "generated.rm");
  writeFileSync(tmpFile, built);
  const dumped = JSON.parse(execFileSync(PYTHON, [join(here, "dump_rmscene.py"), tmpFile]).toString());
  assert(!dumped[tmpFile].error, `rmscene could not read generated page: ${dumped[tmpFile].error}`);
  if (!dumped[tmpFile].error) {
    const text = dumped[tmpFile].paragraphs.map((p) => p.spans.map((s) => s.text).join("")).join("\n");
    const wantText = paraText(reread.paragraphs);
    assert(text === wantText, `rmscene text differs:\n got: ${text}\nwant: ${wantText}`);
    const styles = dumped[tmpFile].paragraphs.map((p) => p.style).join(",");
    const wantStyles = doc.map((p) => p.style).join(",");
    assert(styles === wantStyles, `rmscene styles ${styles} != ${wantStyles}`);
  }
  console.log("rmscene reads our generated page identically");
}

/* 5. Academic layer: footnotes and syntax survive the full round trip. */
const academic = await import(join(here, "build", "academic.js"));

const md = [
  "# Techne paper",
  "",
  "Aristotle treats technē as an *organon*.[^a] The **empeiria** contrast matters.[^b]",
  "",
  "- A bullet point",
  "",
  "```python",
  "print('stashed')",
  "```",
  "",
  "A citation [@Broadie2002, 214] and a comment %%fix this%% survive.",
  "",
  "[^a]: Pace Broadie.",
  "[^b]: Metaphysics A.1, 981a1-12.",
].join("\n");

const sent = academic.markdownToDevice(md);
const sentText = sent.paragraphs.map((p) => p.spans.map((s) => s.text).join("")).join("\n");
assert(sentText.includes("[1]") && sentText.includes("[2]"), "markers frozen on send");
assert(sentText.includes(academic.NOTES_HEADING), "notes section present");
assert(sentText.includes("[1] Pace Broadie."), "definition moved to notes");
assert(!sentText.includes("[^a]"), "no raw footnote keys on device");
assert(!sentText.includes("print("), "code block stashed");
assert(sentText.includes("[@Broadie2002, 214]"), "citation untouched");

// Simulate the device round trip through the codec, then edit on 'device'.
const pageBytes = codec.buildTextPage(sent.paragraphs, authorUuid);
const parsed = codec.parsePage(pageBytes);
const edited = parsed.paragraphs.map((p) => ({
  ...p,
  spans: p.spans.map((s) => ({
    ...s,
    text: s.text.replace(
      "contrast matters.",
      "contrast matters ((Contra Lorenz 2009.)) even more."
    ),
  })),
}));

const pulled = academic.deviceToMarkdown(edited, sent.stash);
assert(pulled.warnings.length === 0, `pull warnings: ${pulled.warnings.join("; ")}`);
assert(pulled.markdown.includes("*organon*.[^1]"), "old footnote 1 restored with italics");
assert(pulled.markdown.includes("((") === false, "((...)) converted");
assert(pulled.markdown.includes("[^2] even more."), "new footnote numbered in sequence");
assert(pulled.markdown.includes("[^2]: Contra Lorenz 2009."), "new definition added");
assert(pulled.markdown.includes("[^3]: Metaphysics A.1, 981a1-12."), "later footnote renumbered");
assert(pulled.markdown.includes("print('stashed')"), "code block restored");
assert(pulled.markdown.includes("%%fix this%%"), "comment survives");
assert(pulled.markdown.includes("# Techne paper"), "heading restored");
assert(pulled.markdown.includes("- A bullet point"), "bullet restored");
console.log("academic layer round trip OK");

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
