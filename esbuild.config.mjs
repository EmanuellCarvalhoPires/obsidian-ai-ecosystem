import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// styles.css is built from src/styles/*.css (one file per area), in name order.
function buildStyles() {
  const dir = "src/styles";
  const parts = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(dir, f), "utf8").trim() + "\n");
  fs.writeFileSync("styles.css", parts.join("\n"));
}

const stylesPlugin = {
  name: "styles",
  setup(build) {
    build.onStart(() => buildStyles());
  },
};

// "import text from './file.mjs?raw'" embeds the file as a string (the Claude Code hook script).
const rawPlugin = {
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};

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
    // Only Node 24 lists this prefix-only module in builtinModules; Node 22 (CI) does not.
    "node:sqlite",
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [stylesPlugin, rawPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
