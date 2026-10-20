// Checks how matcher.js reads item names and which cross-supplier pairs it suggests.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../matcher.js');
const { clean, describe, suggest } = globalThis.Matcher;

const item = (pid, name, sid, price, detail = '') => ({ pid, name, detail, sids: new Set([sid]), price });
const pairs = list => suggest(list).map(s => [s.a.pid, s.b.pid].sort().join('+') + ':' + s.level);

test('writes digits, sizes and spellings the same way', () => {
  assert.equal(clean('شاش طبى ١٠سم*١٠سم'), 'شاش طبي 10 سم 10 سم');
  assert.equal(clean('بلاستر ٧٫٥ سم'), 'بلاستر 7.5 سم');
  assert.equal(clean('7,5 سم'), '7.5 سم');
  assert.equal(clean('1,250'), '1250');
  assert.equal(clean('إبرة'), 'ابره');
  assert.equal(clean('ثري ام').trim(), 'تريام');
  assert.equal(clean('3M tape').trim(), 'تريام tape');
  assert.equal(clean('Lشراب'), 'l شراب');
});

test('describe splits words, sizes, letter sizes and packs', () => {
  assert.deepEqual(describe('شاش طبي 10 سم × 10 سم', ''), { words: ['شاش', 'طبي'], sizes: '10 10', letters: '', packs: '' });
  assert.deepEqual(describe('جاون عزل XL', '').letters, 'xl');
  assert.equal(describe('بلاستر علبة 10', '').packs, 'علبه');
  // "the" prefix dropped from longer words
  assert.deepEqual(describe('المستلزمات', '').words, ['مستلزمات']);
});

test('discount, stock and price details are ignored, other details count', () => {
  assert.deepEqual(describe('قفاز جراحي 7', 'خصم: 28 · رصيد: 40').words, ['قفاز', 'جراحي']);
  assert.equal(describe('قفاز جراحي 7', 'خصم: 28').sizes, '7');
  assert.deepEqual(describe('جاون', 'لون: ازرق').words, ['جاون', 'ازرق']);
});

test('suggests the same item written differently as very likely', () => {
  const got = pairs([
    item('a', 'شاش طبي 10 سم × 10 سم', 'n', 25), item('b', 'شاش طبى ١٠سم*١٠سم', 'd', 22),
    item('c', 'سرنجة 5 مل', 'n', 2.5), item('d', 'سرنجه 5مل', 'd', 2.75),
  ]);
  assert.deepEqual(got.sort(), ['a+b:high', 'c+d:high']);
});

test('never suggests different sizes or letter sizes', () => {
  assert.deepEqual(pairs([item('a', 'شاش طبي 10 سم', 'n', 25), item('b', 'شاش طبي 7.5 سم', 'd', 18)]), []);
  assert.deepEqual(pairs([item('a', 'جاون عزل XL', 'n', 40), item('b', 'جاون عزل L', 'd', 40)]), []);
});

test('never pairs two items of the same supplier', () => {
  assert.deepEqual(pairs([item('a', 'سرنجة 5 مل', 'n', 2.5), item('b', 'سرنجه 5مل', 'n', 2.75)]), []);
});

test('a big price gap or a pack word lowers the level and says why', () => {
  const [s] = suggest([item('a', 'قطن طبي 100 جرام', 'n', 10), item('b', 'قطن طبي 100 جرام', 'd', 40)]);
  assert.equal(s.level, 'medium');
  assert.ok(s.notes.some(n => /4\.0× apart/.test(n.text)));
  const [p] = suggest([item('a', 'قطن طبي 100 جرام علبة', 'n', 10), item('b', 'قطن طبي 100 جرام', 'd', 11)]);
  assert.equal(p.level, 'medium');
  assert.ok(p.notes.some(n => /Only one name says the pack/.test(n.text)));
});

test('an extra size on one side is allowed but flagged', () => {
  const [s] = suggest([item('a', 'رباط ضاغط 5 سم', 'n', 10), item('b', 'رباط ضاغط 5 سم طول 4 م', 'd', 11)]);
  assert.ok(s, 'pair suggested');
  assert.notEqual(s.level, 'high');
  assert.ok(s.notes.some(n => /extra size/.test(n.text)));
});

test('spelling variants are matched and reported', () => {
  const [s] = suggest([item('a', 'كانيولا وريدية 20', 'n', 5), item('b', 'كانيولا وريديه 20', 'd', 5), item('c', 'كانولا وريدية 20', 'x', 5)]);
  assert.ok(s);
  assert.ok(suggest([item('a', 'سباعي جبس 10', 'n', 5), item('b', 'رباعي جبس 10', 'd', 5)]).every(x => !x.notes.some(n => /Spelled/.test(n.text))));
});

test('dismissed pairs stay hidden', () => {
  const list = [item('a', 'سرنجة 5 مل', 'n', 2.5), item('b', 'سرنجه 5مل', 'd', 2.75)];
  assert.equal(suggest(list, { dismissed: { 'a|b': true } }).length, 0);
});

test('one product never floods the list (at most 3 candidates each)', () => {
  const list = [item('a', 'سرنجة 5 مل', 'n', 2.5), ...[1, 2, 3, 4, 5].map(i => item('b' + i, 'سرنجه 5مل', 's' + i, 2.5))];
  assert.ok(suggest(list).filter(s => s.a.pid === 'a' || s.b.pid === 'a').length <= 3);
});
