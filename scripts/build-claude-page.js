// Builds the claude.ai copy of Supply Price Desk as one file: dist/supply-price-desk.html.
// It is the website's index.html with the helper scripts inlined, Firebase swapped for claude-host.js
// (the page's own claude.ai storage) and Claude's help added (claude-ai.js).
// Run: node scripts/build-claude-page.js, then publish the file as a claude.ai artifact.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// claude.ai pages load scripts only from a few CDNs; this SheetJS build is on cdnjs
const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function inline(file) {
  const code = read(file);
  if (/<\/script/i.test(code)) throw new Error(file + ' contains </script>');
  return `<script>\n${code}</script>`;
}

function build() {
  let html = read('index.html');
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error('index.html no longer contains: ' + from);
    html = html.replace(from, () => to);
  };
  swap('<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>', `<script src="${XLSX_CDN}"></script>`);
  html = html.replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\n/g, '');
  swap('<script src="firebase-config.js"></script>', inline('claude-host.js'));
  for (const f of ['table-reader.js', 'pdf-import.js', 'matcher.js']) swap(`<script src="${f}"></script>`, inline(f));
  swap('<style>', inline('claude-ai.js') + '\n<style>');
  // claude.ai wraps the page in its own document, so only the head's contents and the body's go in
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\n?/, '').replace(/<meta name="viewport"[^>]*>\n?/, '')
    .replace('<title>Supply Price Desk</title>', '<title>Supply Price Desk</title>\n<meta name="claude:viewport-fit-sides" content="cover">');
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  if (/<script src="[^"]*(gstatic\.com\/firebasejs|firebase-config)/.test(head + body)) throw new Error('a Firebase script is still in the page');
  const out = path.join(ROOT, 'dist', 'supply-price-desk.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, head.trim() + '\n' + body.trim() + '\n');
  return out;
}

if (require.main === module) console.log('Wrote ' + path.relative(ROOT, build()));
module.exports = { build };
