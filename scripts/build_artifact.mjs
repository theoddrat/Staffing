// Turns the ARTIFACT=1 Vite build (dist-artifact/) into a hosted-artifact page.
// The host wraps the page in its own <!doctype>/<head>/<body> skeleton, so the page is written
// without them; scripts, styles and data are published as files next to it with relative paths.
// Usage: npm run build:artifact  ->  dist-artifact/artifact.html + dist-artifact/publish-files.json
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = new URL('../dist-artifact/', import.meta.url).pathname;
const html = readFileSync(join(out, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('no module script found in dist-artifact/index.html');
const rel = (p) => p.replace(/^\.?\//, '');

const page = [
  '<title>AI Crash Monitor</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...styles.map((h) => `<link rel="stylesheet" href="${rel(h)}">`),
  '<div id="root"></div>',
  ...scripts.map((s) => `<script type="module" src="${rel(s)}"></script>`),
  '',
].join('\n');
writeFileSync(join(out, 'artifact.html'), page);

// Files the page needs at runtime. Font files other than the (inlined) woff2 are fallbacks the
// browser never requests once woff2 loads, so they are not published.
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const key = relative(out, p);
      if (['index.html', 'artifact.html', 'publish-files.json'].includes(key)) continue;
      if (/\.(woff|ttf|eot)$/.test(name)) continue;
      files[key] = p;
    }
  }
};
walk(out);
writeFileSync(join(out, 'publish-files.json'), JSON.stringify(files, null, 1));
const total = Object.values(files).reduce((a, p) => a + statSync(p).size, 0);
console.log(`artifact page: ${join(out, 'artifact.html')}`);
console.log(`${Object.keys(files).length} files, ${(total / 1e6).toFixed(2)} MB:`);
for (const k of Object.keys(files)) console.log(`  ${k}  ${(statSync(files[k]).size / 1e3).toFixed(0)} kB`);
