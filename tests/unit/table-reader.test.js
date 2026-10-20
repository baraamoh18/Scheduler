// Checks how table-reader.js reads prices and turns positioned text (PDF or OCR) into rows.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../table-reader.js');
const T = globalThis.TableReader;

test('parsePrice reads Arabic digits, currency words and thousands', () => {
  assert.equal(T.parsePrice('1,250'), 1250);
  assert.equal(T.parsePrice('1٬250'), 1250);
  assert.equal(T.parsePrice('١٢٥٫٥'), 125.5);
  assert.equal(T.parsePrice('25 ج.م'), 25);
  assert.equal(T.parsePrice('12.5 جنيه'), 12.5);
  assert.equal(T.parsePrice('7,5'), 7.5);
  assert.ok(Number.isNaN(T.parsePrice('abc')));
  assert.ok(Number.isNaN(T.parsePrice('')));
});

test('isNumber tells numbers from names', () => {
  assert.equal(T.isNumber('120'), true);
  assert.equal(T.isNumber('١٢٠ ج.م'), true);
  assert.equal(T.isNumber('شاش 10'), false);
});

// a piece is {str, x0, x1, y, size}; build a right-to-left table: name on the right, price on the left
const piece = (str, x0, x1, y) => ({ str, x0, x1, y, size: 10 });
function rtlTable(rows, header = ['اسم الصنف', 'السعر'], y0 = 50) {
  const ps = [];
  if (header) { ps.push(piece(header[0], 300, 400, y0)); ps.push(piece(header[1], 50, 90, y0)); }
  rows.forEach(([name, price], i) => { const y = y0 + 20 * (i + 1); ps.push(piece(name, 220, 400, y)); ps.push(piece(price, 50, 90, y)); });
  return ps;
}

test('reads a right-to-left table with a header', () => {
  const { rows } = T.readPieces(rtlTable([['شاش طبي 10 سم', '25'], ['سرنجة 5 مل', '2.50']]));
  assert.deepEqual(rows.map(r => [r.name, r.price]), [['شاش طبي 10 سم', 25], ['سرنجة 5 مل', 2.5]]);
});

test('reads a table without a header from how the columns line up', () => {
  const { rows } = T.readPieces(rtlTable([['شاش طبي 10 سم', '25'], ['سرنجة 5 مل', '2.50'], ['رباط ضاغط', '15']], null));
  assert.deepEqual(rows.map(r => r.price), [25, 2.5, 15]);
});

test('keeps the layout from one page for the next (state)', () => {
  const state = {};
  T.readPieces(rtlTable([['شاش طبي', '25']]), state);
  const { rows } = T.readPieces(rtlTable([['قطن طبي', '30'], ['جاون', '40']], null), state);
  assert.deepEqual(rows.map(r => r.name), ['قطن طبي', 'جاون']);
});

test('a lone heading above a table header becomes the category', () => {
  const ps = [piece('أولاً المستلزمات الطبية', 200, 400, 20), ...rtlTable([['جاون طبي', '22.75']])];
  const { rows } = T.readPieces(ps, {});
  assert.equal(rows[0].category, 'أولاً المستلزمات الطبية');
});

test('an extra numeric column becomes a labelled detail', () => {
  const ps = [piece('اسم المنتج', 300, 400, 50), piece('الجرام', 150, 190, 50), piece('السعر', 50, 90, 50),
    piece('جاون طبي', 250, 400, 70), piece('40', 150, 170, 70), piece('22.75', 50, 90, 70)];
  const { rows } = T.readPieces(ps, {});
  assert.deepEqual([rows[0].name, rows[0].detail, rows[0].price], ['جاون طبي', 'الجرام: 40', 22.75]);
});

test('two tables side by side are both read', () => {
  const ps = [piece('اسم الصنف', 700, 800, 50), piece('السعر', 520, 560, 50), piece('اسم الصنف', 300, 400, 50), piece('السعر', 50, 90, 50)];
  [['شاش', '25', 'قطن', '30'], ['سرنجة', '2', 'جاون', '40']].forEach(([a, pa, b, pb], i) => {
    const y = 70 + 20 * i;
    ps.push(piece(a + ' طبي', 640, 800, y), piece(pa, 520, 560, y), piece(b + ' طبي', 240, 400, y), piece(pb, 50, 90, y));
  });
  const { rows } = T.readPieces(ps, {});
  assert.deepEqual(rows.map(r => r.name).sort(), ['جاون طبي', 'سرنجة طبي', 'شاش طبي', 'قطن طبي'].sort());
});

test('a product name wrapped onto a second line is joined', () => {
  const ps = rtlTable([['جاون طبي معقم', '40'], ['سرنجة 5 مل', '2']]);
  ps.push(piece('مقاس كبير', 300, 400, 78)); // the loose second line of the first item
  const { rows } = T.readPieces(ps, {});
  assert.equal(rows[0].name, 'جاون طبي معقم مقاس كبير');
});

test('lines with an email or website are not items', () => {
  const { rows } = T.readPieces(rtlTable([['شاش طبي', '25'], ['sales@example.com', '0100']]));
  assert.deepEqual(rows.map(r => r.name), ['شاش طبي']);
});

test('looksBroken catches a corrupt text layer', () => {
  assert.equal(T.looksBroken([]), true);
  assert.equal(T.looksBroken([{ str: 'شاش طبي 25' }]), false);
  assert.equal(T.looksBroken([{ str: '\u0001\u0002\u0003abc' }]), true);
});

test('piecesFromPdf flips y and keeps widths', () => {
  const [p] = T.piecesFromPdf({ items: [{ str: 'شاش', transform: [10, 0, 0, 10, 100, 700], width: 30 }, { str: ' ', transform: [10, 0, 0, 10, 0, 0], width: 1 }] }, 800);
  assert.deepEqual(p, { str: 'شاش', x0: 100, x1: 130, y: 100, size: 10 });
});

test('piecesFromOcr drops low-confidence words and keeps line numbers', () => {
  const ps = T.piecesFromOcr([{ bbox: { y0: 0, y1: 20 }, words: [{ text: 'شاش', confidence: 90, bbox: { x0: 0, x1: 10, y0: 0, y1: 20 } }, { text: '??', confidence: 10, bbox: { x0: 0, x1: 1, y0: 0, y1: 1 } }] }]);
  assert.deepEqual(ps.map(p => [p.str, p.line]), [['شاش', 0]]);
});
