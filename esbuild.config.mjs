import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const mode = process.argv[2];

if (mode === "test") {
  await esbuild.build({
    entryPoints: ["src/rm/codec.ts", "src/academic.ts", "src/store.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2020",
    outdir: "test/build",
    logLevel: "info",
  });
  process.exit(0);
}

const prod = mode === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
