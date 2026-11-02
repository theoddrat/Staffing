// Builds the standalone app: the whole frontend, its in-browser backend (src/local/) and the course content
// in ONE self-contained HTML page for a claude.ai Artifact - no server, no network.
//
//   npm run build:standalone      ->  standalone/dist/index.html    (the artifact page: no doctype/html/head/body,
//                                                                     the platform wraps it)
//                                     standalone/dist/preview.html  (the same page in the platform's wrapper, for
//                                                                     local testing: standalone/e2e)
//
// Steps: Tailwind CSS (src/app/globals.css, scanning src/ and standalone/) with the Tailwind v4 CLI; KaTeX CSS
// with its woff2 fonts embedded as data URIs; one esbuild bundle (IIFE) of standalone/main.tsx with React,
// content.json and the next/* shims; then everything inlined into the page.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url)); // frontend/standalone
const root = path.resolve(here, ".."); // frontend
const dist = path.join(here, "dist");
const tmp = path.join(dist, ".tmp");
const TITLE = "The Mathematical Universe";
const MAX_BYTES = 16 * 1024 * 1024; // artifact page limit

const rel = (from, to) => path.relative(from, to).split(path.sep).join("/");
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ---------------------------------------------------------------------------------------------- Tailwind

function tailwindCss() {
  const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const IMPORT = '@import "tailwindcss";';
  if (!globals.includes(IMPORT)) throw new Error(`src/app/globals.css no longer starts with ${IMPORT} - update build.mjs`);
  // Scan exactly the code that is bundled (not content.json, the build output or the tests).
  const sources = [
    '@import "tailwindcss" source(none);',
    `@source "${rel(tmp, path.join(root, "src"))}";`,
    `@source "${rel(tmp, here)}";`,
    `@source not "${rel(tmp, dist)}";`,
    `@source not "${rel(tmp, path.join(here, "e2e"))}";`,
    `@source not "${rel(tmp, path.join(here, "content.json"))}";`,
  ].join("\n");
  const input = path.join(tmp, "tailwind.input.css");
  const output = path.join(tmp, "tailwind.css");
  fs.writeFileSync(input, globals.replace(IMPORT, sources));
  const cli = path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs");
  if (!fs.existsSync(cli)) throw new Error("@tailwindcss/cli is not installed - run npm install in frontend/");
  execFileSync(process.execPath, [cli, "--input", input, "--output", output, "--minify", "--silent"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const css = fs.readFileSync(output, "utf8");
  // The page must paint its themed background before any script runs.
  if (!/body\{[^}]*background:var\(--bg\)/.test(css)) throw new Error("compiled CSS has no themed body background");
  return css;
}

// ---------------------------------------------------------------------------------------------- KaTeX

function katexCss() {
  const dir = path.join(root, "node_modules/katex/dist");
  let fonts = 0;
  const css = fs
    .readFileSync(path.join(dir, "katex.min.css"), "utf8")
    // src:url(fonts/X.woff2) format("woff2"),url(fonts/X.woff) format("woff"),url(fonts/X.ttf) format("truetype")
    .replace(/src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)(?:,url\(fonts\/[\w-]+\.\w+\) format\("[\w-]+"\))*/g, (_, name) => {
      fonts += 1;
      const data = fs.readFileSync(path.join(dir, "fonts", `${name}.woff2`)).toString("base64");
      return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
    });
  if (!fonts) throw new Error("no KaTeX @font-face rules found - has katex.min.css changed?");
  if (/url\((?!data:)/.test(css)) throw new Error("KaTeX CSS still refers to external files");
  return { css, fonts };
}

// ---------------------------------------------------------------------------------------------- JavaScript

const SHIMS = {
  "next/link": path.join(here, "shims/next-link.tsx"),
  "next/navigation": path.join(here, "shims/next-navigation.ts"),
};

/** `@/x` -> src/x (as in tsconfig paths); next/* -> the standalone shims (anything else from next is an error). */
const resolvePlugin = {
  name: "mu-resolve",
  setup(b) {
    b.onResolve({ filter: /^next(\/|$)/ }, (args) =>
      SHIMS[args.path]
        ? { path: SHIMS[args.path] }
        : { errors: [{ text: `"${args.path}" has no standalone shim: add one in standalone/shims/ and to SHIMS in build.mjs` }] },
    );
    b.onResolve({ filter: /^@\// }, (args) =>
      b.resolve(`./${args.path.slice(2)}`, { kind: args.kind, resolveDir: path.join(root, "src"), importer: args.importer }),
    );
  },
};

async function bundle() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [path.join(here, "main.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    define: {
      "process.env.NEXT_PUBLIC_MU_STANDALONE": '"1"',
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [resolvePlugin],
    write: false,
    metafile: true,
    logLevel: "warning",
    // "use client" directives mean nothing in a single bundle.
    logOverride: { "unsupported-directive": "silent" },
  });
  let js = result.outputFiles[0].text;
  // Inline-script safety: nothing may close the <script> element or open an HTML comment inside it.
  js = js.replace(/<\/(script)/gi, "\\x3C/$1").replace(/<!--/g, "\\x3C!--");
  if (/<\/script/i.test(js)) throw new Error("bundle still contains </script");
  // esbuild writes ASCII except inside regular expressions (KaTeX has a few): escape those too, so the page
  // reads the same whatever charset it is served with. (\uXXXX means the same in strings, regexes and names.)
  js = js.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const leftover = js.match(/.{0,60}\bprocess\.env\b.{0,60}/);
  if (leftover) console.warn(`warning: the bundle still reads process.env: ...${leftover[0]}...`);
  return { js, inputs: Object.keys(result.metafile.inputs).length };
}

// ---------------------------------------------------------------------------------------------- page

function nonAscii(s) {
  const m = s.match(/[^\x00-\x7f]/);
  return m ? `${JSON.stringify(m[0])} near ...${s.slice(Math.max(0, m.index - 40), m.index + 40)}...` : null;
}

async function main() {
  const t0 = Date.now();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const [tw, katex, js] = [tailwindCss(), katexCss(), await bundle()];
  for (const [name, css] of [["Tailwind", tw], ["KaTeX", katex.css]]) {
    if (/<\/style/i.test(css)) throw new Error(`${name} CSS contains </style`);
  }

  // A static loading screen (Tailwind classes, so it is themed) shows while the script is parsed;
  // main.tsx replaces it as soon as it runs.
  const loading =
    '<div id="root"><div class="flex min-h-screen items-center justify-center p-6">' +
    `<p class="animate-pulse font-serif text-lg text-ink-3">Opening ${TITLE}&hellip;</p></div></div>`;
  const page = [
    `<title>${TITLE}</title>`,
    `<style>${katex.css}</style>`,
    `<style>${tw}</style>`,
    loading,
    `<script>${js.js}</script>`,
    "",
  ].join("\n");

  const bad = nonAscii(page);
  if (bad) console.warn(`warning: the page is not pure ASCII, so it relies on being served as UTF-8: ${bad}`);

  fs.writeFileSync(path.join(dist, "index.html"), page);
  // What the platform serves: the page wrapped in a document skeleton.
  fs.writeFileSync(
    path.join(dist, "preview.html"),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      `</head><body>${page}</body></html>\n`,
  );
  fs.rmSync(tmp, { recursive: true, force: true });

  const size = Buffer.byteLength(page);
  console.log(
    `standalone/dist/index.html: ${(size / 1024 / 1024).toFixed(2)} MB (${size} bytes) - ` +
      `JS ${kb(js.js.length)} from ${js.inputs} modules, Tailwind CSS ${kb(tw.length)}, ` +
      `KaTeX CSS ${kb(katex.css.length)} with ${katex.fonts} fonts - built in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  if (size > MAX_BYTES) throw new Error(`the page is over the artifact limit of ${MAX_BYTES} bytes`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
