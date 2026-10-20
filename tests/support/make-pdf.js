// Builds a small one-page PDF with a real text layer (Helvetica, so Latin text only).
// lines: [{x, y, text}] in points from the top-left of an A4 page.
function makePdf(lines) {
  const esc = s => String(s).replace(/[\\()]/g, c => '\\' + c);
  const content = lines.map(l => `BT /F1 11 Tf ${l.x} ${842 - l.y} Td (${esc(l.text)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// a price list: header "Item name | Price", then one row per [name, price]
function priceListPdf(rows) {
  const lines = [{ x: 60, y: 80, text: 'Item name' }, { x: 400, y: 80, text: 'Price' }];
  rows.forEach(([name, price], i) => lines.push({ x: 60, y: 100 + i * 20, text: name }, { x: 400, y: 100 + i * 20, text: String(price) }));
  return makePdf(lines);
}
module.exports = { makePdf, priceListPdf };
