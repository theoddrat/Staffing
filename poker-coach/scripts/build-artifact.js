// Package the app as a single page (inline CSS) plus its ES modules, for
// hosting where only the page body is authored (e.g. a Claude artifact).
//
//   node scripts/build-artifact.js <outDir>
//
// Writes <outDir>/index.html and copies src/** next to it.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/build-artifact.js <outDir>'); process.exit(1); }

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/app.css'), 'utf8');
const title = html.match(/<title>([^<]*)<\/title>/)[1];
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1];
const page = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
<div id="app"><p style="padding:24px;font-family:system-ui">Loading the card room…</p></div>
<script type="module" src="src/ui/app.js"></script>
`;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), page);

const files = [];
function copyDir(rel) {
  for (const name of readdirSync(join(root, rel))) {
    const r = join(rel, name);
    if (statSync(join(root, r)).isDirectory()) copyDir(r);
    else if (name.endsWith('.js')) {
      mkdirSync(join(out, rel), { recursive: true });
      copyFileSync(join(root, r), join(out, r));
      files.push(r);
    }
  }
}
copyDir('src');
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.fromEntries(files.map((f) => [f, f])), null, 2));
console.log(`wrote ${out}/index.html and ${files.length} modules`);
