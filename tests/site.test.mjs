// Offline tests for the Credits Explorer: node --test tests/site.test.mjs
// The page's pure functions (site/app.js) must agree with counts computed here, straight from catalog/plans.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const rows = JSON.parse(read('catalog/plans.json')).rows;
const app = await import('../site/app.js');
const { LANES, DEFAULT_FILTER, applyFilter, laneCounts, firstLaneCounts, summary, parseMultiple, valueRows, parseHash, toHash } = app;
const f = (over) => ({ ...DEFAULT_FILTER, ...over });

test('the catalog has rows and the page knows every lane', () => {
  assert.ok(rows.length > 100);
  const seen = new Set(rows.flatMap((r) => r.lanes));
  assert.deepEqual([...seen].sort(), [...LANES].sort());
});

test('summary tiles agree with plans.json', () => {
  let free = 0;
  let newest = '';
  for (const r of rows) {
    if (r.price_month === 0) free += 1;
    if (r.checked > newest) newest = r.checked;
  }
  assert.deepEqual(summary(rows), { rows: rows.length, free, lanes: LANES.length, newest });
});

test('rows per lane: free, paid and unpriced add up to the lane total', () => {
  const counts = laneCounts(rows);
  for (const lane of LANES) {
    const inLane = rows.filter((r) => r.lanes.includes(lane));
    assert.equal(counts[lane].total, inLane.length, lane);
    assert.equal(counts[lane].free, inLane.filter((r) => r.price_month === 0).length, `${lane} free`);
    assert.equal(counts[lane].paid, inLane.filter((r) => r.price_month > 0).length, `${lane} paid`);
    assert.equal(counts[lane].none, inLane.filter((r) => r.price_month == null).length, `${lane} none`);
    assert.equal(counts[lane].free + counts[lane].paid + counts[lane].none, counts[lane].total);
  }
});

test('first-lane counts sum to the row count', () => {
  const first = firstLaneCounts(rows);
  assert.equal(Object.values(first).reduce((a, b) => a + b, 0), rows.length);
  for (const lane of LANES) assert.equal(first[lane], rows.filter((r) => r.lanes[0] === lane).length);
});

test('filters match a plain loop over plans.json', () => {
  const cases = [
    [f({}), () => true],
    [f({ lanes: ['gpu'] }), (r) => r.lanes.includes('gpu')],
    [f({ lanes: ['gpu', 'cpu'] }), (r) => r.lanes.includes('gpu') || r.lanes.includes('cpu')],
    [f({ free: true }), (r) => r.price_month === 0],
    [f({ card: 'no' }), (r) => r.card === false],
    [f({ card: 'yes' }), (r) => r.card === true],
    [f({ overage: 'stops' }), (r) => r.overage === 'stops'],
    [f({ overage: 'bills' }), (r) => r.overage === 'bills'],
    [f({ lanes: ['inference'], free: true, card: 'no', overage: 'stops' }),
      (r) => r.lanes.includes('inference') && r.price_month === 0 && r.card === false && r.overage === 'stops'],
    [f({ q: 'hugging' }), (r) => `${r.name} ${r.provider} ${r.id} ${r.includes} ${r.lanes.join(' ')}`.toLowerCase().includes('hugging')],
    [f({ q: 'GPU  free' }), (r) => { const h = `${r.name} ${r.provider} ${r.id} ${r.includes} ${r.lanes.join(' ')}`.toLowerCase(); return h.includes('gpu') && h.includes('free'); }],
  ];
  for (const [filter, want] of cases) {
    assert.equal(applyFilter(rows, filter).length, rows.filter(want).length, JSON.stringify(filter));
  }
  assert.ok(applyFilter(rows, f({ q: 'hugging' })).length > 0, 'the search finds something');
});

test('the lane facet ignores the lane filter and obeys the rest', () => {
  const facet = laneCounts(applyFilter(rows, f({ lanes: [], free: true })));
  for (const lane of LANES) assert.equal(facet[lane].total, rows.filter((r) => r.price_month === 0 && r.lanes.includes(lane)).length);
});

test('hash round trip keeps the filter and drops junk', () => {
  const filter = f({ lanes: ['cpu', 'gpu'], free: true, card: 'no', overage: 'bills', q: 'nvidia' });
  assert.deepEqual(parseHash(toHash(filter)), filter);
  assert.equal(toHash(DEFAULT_FILTER), '');
  assert.deepEqual(parseHash('#lanes=nope,gpu&card=maybe&overage=x&free=2'), f({ lanes: ['gpu'] }));
  assert.equal(toHash(parseHash('#lanes=gpu,cpu')), '#lanes=cpu%2Cgpu');
});

test('subscription multiples are read only where the text says one', () => {
  assert.equal(parseMultiple('3x face value'), 3);
  assert.equal(parseMultiple('$60 of credit for $20, so 3x face value at the pay-as-you-go rates (computed).'), 3);
  assert.equal(parseMultiple('2.0x at API token rates'), 2);
  assert.equal(parseMultiple('1.10x (Max 1.125x)'), 1.1);
  assert.equal(parseMultiple('0.5x'), 0.5);
  assert.equal(parseMultiple('About $0.0083 per credit vs 1 cent, about 1.2x (computed).'), 1.2);
  assert.equal(parseMultiple('6% (Pro 10%) off PAYG'), 1.06);
  assert.equal(parseMultiple('1.5x to 10x the $40 fee per model (computed)'), null);
  assert.equal(parseMultiple('Same quota as PRO at $20 instead of $9 (2.2x).'), null);
  assert.equal(parseMultiple('Pay-As-You-Go, if switched on, runs at 2x the standard rate'), null);
  assert.equal(parseMultiple(null), null);
});

test('the value chart lists paid rows with a multiple, biggest first', () => {
  const list = valueRows(rows);
  assert.ok(list.length > 5, 'the catalog states several multiples');
  for (const { row, multiple } of list) {
    assert.ok(row.price_month > 0);
    assert.equal(multiple, parseMultiple(row.unit_cost_vs_payg));
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].multiple >= list[i].multiple);
  const want = rows.filter((r) => r.price_month > 0 && parseMultiple(r.unit_cost_vs_payg) !== null).length;
  assert.equal(list.length, want);
});

test('index.html loads plans.json, the pinned three.js and the sister repos', () => {
  const html = read('site/index.html');
  assert.match(html, /data-plans="plans\.json"/);
  const m = /data-three="(https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/(\d+\.\d+\.\d+)\/three\.module\.min\.js)"/.exec(html);
  assert.ok(m, 'a three.js URL on cdnjs with an exact version');
  const [major, minor] = m[2].split('.').map(Number);
  assert.ok(major === 0 && minor >= 160, 'a version old enough to be on cdnjs and past the module-only switch');
  assert.match(html, /name="viewport"/);
  assert.match(html, /Colorado-Startups\/startup-credits/);
  assert.match(html, /SoulCraft-Org\/compute-crafter/);
  assert.doesNotMatch(html, /three\.js\/(latest|r\d+)\//);
});

test('the Pages workflow copies the site and the catalog, and pins every action by full SHA', () => {
  const yml = read('.github/workflows/pages.yml');
  assert.match(yml, /cp catalog\/plans\.json _site\/plans\.json/);
  assert.match(yml, /cp site\/\* _site\//);
  const uses = yml.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.ok(uses.length >= 4);
  for (const l of uses) assert.match(l, /@[0-9a-f]{40} # v\d/, l);
  assert.match(yml, /actions\/deploy-pages@/);
});
