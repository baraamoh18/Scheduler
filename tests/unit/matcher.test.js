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
  const d = describe('شاش طبي 10 سم × 10 سم', '');
  assert.deepEqual([d.words, d.sizes, d.letters, d.packs], [['شاش', 'طبي'], '10 10', '', '']);
  assert.deepEqual(describe('جاون عزل XL', '').letters, 'xl');
  assert.equal(describe('بلاستر علبة 10', '').packs, 'علبه');
  // "the" prefix dropped from longer words
  assert.deepEqual(describe('المستلزمات', '').words, ['مستلزمات']);
});

test('discount, stock and price details are ignored, other details count', () => {
  assert.deepEqual(describe('شاش جراحي 7', 'خصم: 28 · رصيد: 40').words, ['شاش', 'جراحي']);
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

test('same-meaning words, colours and "ال" are read as one word', () => {
  assert.equal(clean('كانيولا ١٨خضراء'), 'كانيولا 18 اخضر');
  assert.equal(clean('قفاز'), 'جوانتي');
  assert.equal(clean('غيار جراحي لاصق'), 'دريسنج لاصق');
  assert.equal(clean('الاطفال'), 'اطفال');
  assert.deepEqual(pairs([item('a', 'كانيولا ١٨خضراء', 'n', 6), item('b', 'كانيولا اخضر 18', 'd', 6)]), ['a+b:high']);
  assert.deepEqual(pairs([item('a', 'فولي 12', 'n', 24), item('b', 'قسطرة فولى 12', 'd', 25)]), ['a+b:high']);
  // a brand named on one side only is shown as an extra word
  const [s] = suggest([item('a', 'كانيولا الترا ١٨خضراء', 'n', 6), item('b', 'كانيولا اخضر 18', 'd', 6)]);
  assert.equal(s.level, 'medium');
  assert.deepEqual(s.onlyA, ['الترا']);
});

test('words that tell items apart block a pair; on one side only they are flagged', () => {
  assert.deepEqual(pairs([item('a', 'سرنجات دولية 3 سم اطفال', 'n', 3), item('b', 'سرنجات دولية 3 سم سيدات', 'd', 3)]), []);
  assert.deepEqual(pairs([item('a', 'شراب دوالي فوق الركبة L', 'n', 3), item('b', 'شراب دوالى تحت الركبه L', 'd', 3)]), []);
  assert.deepEqual(pairs([item('a', 'دريسنج لاصق 10*10', 'n', 3), item('b', 'دريسنج غير لاصق 10*10', 'd', 3)]), []);
  assert.deepEqual(pairs([item('a', 'كانيولا 22 ازرق', 'n', 3), item('b', 'كانيولا 22 اصفر', 'd', 3)]), []);
  const [s] = suggest([item('a', 'كيس جمع بول', 'n', 5), item('b', 'كيس جمع بول اطفال', 'd', 5)]);
  assert.equal(s.level, 'medium');
  assert.ok(s.notes.some(n => n.text === 'Only one name says اطفال'));
});

test('a different brand is weak and says so; the same brand is noted', () => {
  const [s] = suggest([item('a', 'حزام ظهر عادي ميراج L', 'n', 90), item('b', 'موف حزام ظهر عادى L', 'd', 95)]);
  assert.equal(s.level, 'low');
  assert.equal(s.notes[0].text, 'Different brand: ميراج / موف');
  const [m] = suggest([item('a', 'Mانكل مفتوح ميراج', 'n', 29), item('b', 'ميراج انكل مفتوح M', 'd', 31)]);
  assert.equal(m.level, 'high');
  assert.ok(m.notes.some(n => n.ok && n.text === 'Same brand ميراج'));
  // a brand written as two words is shown the way the list writes it
  const [k] = suggest([item('a', 'شراب دوالي ميدي كير L', 'n', 75), item('b', 'شراب دوالي ميراج L', 'd', 75)]);
  assert.equal(k.notes[0].text, 'Different brand: ميدي كير / ميراج');
});

test('grams and percentages are kept apart from sizes, and codes are not sizes', () => {
  const d = describe('جاون مريض 140*110 22 جرام', '');
  assert.equal(d.sizes, '110 140');
  assert.equal(d.specs, '22g');
  assert.equal(describe('كحول اسبراي 70%', '').specs, '70%');
  assert.equal(describe('صندل جبس كود ٢١٠', '').sizes, '');
  assert.deepEqual(pairs([item('a', 'جاون مريض 140*110 22 جرام', 'n', 9), item('b', 'جاون مريض 140*110 35 جرام', 'd', 13)]), []);
});

test('the word lists can be changed, and the change is used right away', () => {
  try {
    const sugar = () => suggest([item('a', 'جهاز سكر اونكول', 'n', 300), item('b', 'جهاز سكر ساندا', 'd', 300)])[0];
    assert.ok(!sugar().notes.some(n => /Different brand/.test(n.text)));
    globalThis.Matcher.setWords({ brands: 'اونكول = اون كول\nساندا' });
    assert.equal(sugar().level, 'low');
    assert.equal(sugar().notes[0].text, 'Different brand: اونكول / ساندا');
    globalThis.Matcher.setWords({ same: 'دعامه = ستنت' });
    assert.deepEqual(pairs([item('a', 'دعامة 12', 'n', 24), item('b', 'ستنت 12', 'd', 25)]), ['a+b:high']);
    globalThis.Matcher.setWords({ opposites: '' });
    assert.deepEqual(describe('كيس بول اطفال', '').opp, {});
  } finally { globalThis.Matcher.setWords(); }
});
