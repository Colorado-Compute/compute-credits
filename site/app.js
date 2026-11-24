// Credits Explorer. The first half is pure: filters, counts, chart rows and the URL hash. Node imports it for the tests.
// The second half builds the page and runs only where there is a document.

export const LANES = ['ci', 'cpu', 'gpu', 'inference', 'hosting', 'tools'];
export const LANE_NAMES = { ci: 'CI', cpu: 'CPU', gpu: 'GPU', inference: 'Inference', hosting: 'Hosting', tools: 'Tools' };
export const DEFAULT_FILTER = Object.freeze({ lanes: [], free: false, card: 'any', overage: 'any', q: '' });

// ---------- pure: rows, filters, counts ----------

/** 'free' (price 0), 'paid' (price above 0) or 'none' (no monthly price stated). */
export const priceKind = (r) => (r.price_month === 0 ? 'free' : r.price_month > 0 ? 'paid' : 'none');

export function matches(r, f) {
  if (f.lanes.length && !r.lanes.some((l) => f.lanes.includes(l))) return false;
  if (f.free && priceKind(r) !== 'free') return false;
  if (f.card === 'yes' && r.card !== true) return false;
  if (f.card === 'no' && r.card !== false) return false;
  if (f.overage === 'stops' && r.overage !== 'stops') return false;
  if (f.overage === 'bills' && r.overage !== 'bills') return false;
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hay = [r.name, r.provider, r.id, r.includes, r.lanes.join(' ')].join(' ').toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const applyFilter = (rows, f) => rows.filter((r) => matches(r, f));

/** Rows per lane, split by price kind. A row in two lanes counts in both. */
export function laneCounts(rows) {
  const out = {};
  for (const l of LANES) out[l] = { free: 0, paid: 0, none: 0, total: 0 };
  for (const r of rows) {
    for (const l of r.lanes) {
      if (!out[l]) continue;
      out[l][priceKind(r)] += 1;
      out[l].total += 1;
    }
  }
  return out;
}

/** The README's way of counting: each row once, under its first lane. */
export function firstLaneCounts(rows) {
  const out = Object.fromEntries(LANES.map((l) => [l, 0]));
  for (const r of rows) if (out[r.lanes[0]] !== undefined) out[r.lanes[0]] += 1;
  return out;
}

export function summary(rows) {
  const lanes = new Set();
  let free = 0;
  let newest = '';
  for (const r of rows) {
    if (priceKind(r) === 'free') free += 1;
    for (const l of r.lanes) lanes.add(l);
    if (r.checked > newest) newest = r.checked;
  }
  return { rows: rows.length, free, lanes: lanes.size, newest };
}

// ---------- pure: subscription value ----------

const MULTIPLE_PATTERNS = [
  /^\s*(?:about\s+)?(\d+(?:\.\d+)?)x\b(?!\s+to\b)/i, // "3x ...", "2.0x at API token rates", "0.5x"
  /\bso\s+(\d+(?:\.\d+)?)x\s+face value/i, // "$60 of credit for $20, so 3x face value"
  /\babout\s+(\d+(?:\.\d+)?)x\s*\(computed\)/i, // "... about 1.2x (computed)"
];

/**
 * unit_cost_vs_payg is free text. A multiple counts only when the text opens with one, says "so Nx face value" or
 * "about Nx (computed)", or opens with "N% ... off". Ranges ("1.5x to 10x") and ratios between other things
 * ("2.2x" of another plan's price) are left out, so a row is never charted on a guess.
 */
export function parseMultiple(text) {
  if (typeof text !== 'string') return null;
  for (const re of MULTIPLE_PATTERNS) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  const off = /^\s*(\d+(?:\.\d+)?)%[^.]*\boff\b/i.exec(text);
  if (off && Number(off[1]) < 100) return Math.round((100 / (100 - Number(off[1]))) * 100) / 100;
  return null;
}

/** Paid rows that state a multiple, biggest first. */
export function valueRows(rows) {
  const out = [];
  for (const r of rows) {
    if (priceKind(r) !== 'paid') continue;
    const multiple = parseMultiple(r.unit_cost_vs_payg);
    if (multiple !== null) out.push({ row: r, multiple });
  }
  return out.sort((a, b) => b.multiple - a.multiple || a.row.name.localeCompare(b.row.name));
}

// ---------- pure: the URL hash ----------

export function parseHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const pick = (v, ok, dflt) => (ok.includes(v) ? v : dflt);
  return {
    lanes: (p.get('lanes') || '').split(',').filter((l) => LANES.includes(l)),
    free: p.get('free') === '1',
    card: pick(p.get('card'), ['yes', 'no'], 'any'),
    overage: pick(p.get('overage'), ['stops', 'bills'], 'any'),
    q: (p.get('q') || '').slice(0, 80),
  };
}

export function toHash(f) {
  const p = new URLSearchParams();
  if (f.lanes.length) p.set('lanes', LANES.filter((l) => f.lanes.includes(l)).join(','));
  if (f.free) p.set('free', '1');
  if (f.card !== 'any') p.set('card', f.card);
  if (f.overage !== 'any') p.set('overage', f.overage);
  if (f.q.trim()) p.set('q', f.q.trim());
  const s = p.toString();
  return s ? `#${s}` : '';
}

export const isDefaultFilter = (f) => toHash(f) === '';

// ---------- pure: display text ----------

const SYMBOLS = { USD: '$', EUR: '€' };
export function priceText(r) {
  const k = priceKind(r);
  if (k === 'free') return { big: 'Free', small: '' };
  if (k === 'none') return { big: 'No set price', small: '' };
  const n = Number.isInteger(r.price_month) ? String(r.price_month) : r.price_month.toFixed(2);
  return { big: `${SYMBOLS[r.currency] ?? ''}${n}`, small: SYMBOLS[r.currency] ? '/mo' : `${r.currency || ''}/mo` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
}

export function daysAgo(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - then) / 86400000));
}

export const ageText = (days) => (days === null ? '' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

// ---------- page ----------

if (typeof document !== 'undefined') boot();

function boot() {
  const root = document.documentElement;
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, el = document) => el.querySelector(s);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const icon = (name, cls = 'i') => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  };

  let all = [];
  let filter = parseHash(location.hash);
  let visible = [];
  let shown = 24;
  let scene = null;
  const byId = new Map();

  // ----- tooltip (one element, text only) -----
  const tip = $('#tip');
  function showTip(lines, x, y) {
    tip.replaceChildren(...lines.map((l, i) => h('div', { class: i === 0 ? 'tip-head' : 'tip-line' }, l)));
    tip.hidden = false;
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 14, innerHeight - hgt - 8))}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  function tipOn(el, getLines) {
    el.addEventListener('pointermove', (e) => showTip(getLines(), e.clientX, e.clientY));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(getLines(), r.left + 24, r.top + r.height / 2 - 14); });
    el.addEventListener('blur', hideTip);
  }

  // ----- count-up numbers -----
  function setNum(el, to, fmt = (n) => String(n)) {
    const from = el._v ?? 0;
    el._v = to;
    cancelAnimationFrame(el._raf);
    if (reduced || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 420);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // ----- tiles -----
  const tile = {
    rows: $('#t-rows'), free: $('#t-free'), lanes: $('#t-lanes'), newest: $('#t-newest'),
  };
  function renderTiles() {
    const s = summary(visible);
    const total = all.length;
    setNum(tile.rows.num, s.rows);
    tile.rows.sub.textContent = `of ${total}`;
    tile.rows.meter.style.setProperty('--p', total ? s.rows / total : 0);
    setNum(tile.free.num, s.free);
    tile.free.sub.textContent = s.rows ? `${Math.round((s.free / s.rows) * 100)}% of rows` : 'no rows';
    tile.free.meter.style.setProperty('--p', s.rows ? s.free / s.rows : 0);
    setNum(tile.lanes.num, s.lanes);
    const present = new Set(visible.flatMap((r) => r.lanes));
    tile.lanes.glyphs.forEach((g) => g.classList.toggle('on', present.has(g.dataset.lane)));
    tile.newest.num.textContent = s.newest ? shortDate(s.newest) : 'none';
    tile.newest.sub.textContent = s.newest ? ageText(daysAgo(s.newest)) : '';
  }
  function initTiles() {
    for (const key of ['rows', 'free', 'lanes', 'newest']) {
      const el = $(`#t-${key}`);
      tile[key].num = $('.num', el);
      tile[key].sub = $('.sub', el);
      tile[key].meter = $('.meter', el);
    }
    const g = $('.glyphs', tile.lanes);
    tile.lanes.glyphs = LANES.map((l) => { const s = h('span', { class: 'glyph', 'data-lane': l, title: LANE_NAMES[l] }, icon(l)); g.append(s); return s; });
  }

  // ----- filter controls -----
  const chipBox = $('#chips');
  const chips = {};
  function buildChips() {
    for (const l of LANES) {
      const n = h('span', { class: 'n' });
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => toggleLane(l) }, icon(l), LANE_NAMES[l], n);
      chips[l] = { b, n };
      chipBox.append(b);
    }
  }
  function toggleLane(l) {
    const on = filter.lanes.includes(l);
    setFilter({ ...filter, lanes: on ? filter.lanes.filter((x) => x !== l) : [...filter.lanes, l] });
  }
  function syncControls() {
    for (const l of LANES) chips[l].b.setAttribute('aria-pressed', String(filter.lanes.includes(l)));
    const sw = $('#free');
    sw.setAttribute('aria-checked', String(filter.free));
    for (const el of document.querySelectorAll('input[name=card],input[name=overage]')) el.checked = el.value === filter[el.name];
    const q = $('#q');
    if (document.activeElement !== q) q.value = filter.q;
    $('#clear').hidden = isDefaultFilter(filter);
  }
  function wireControls() {
    $('#free').addEventListener('click', () => setFilter({ ...filter, free: !filter.free }));
    for (const el of document.querySelectorAll('input[name=card],input[name=overage]')) {
      el.addEventListener('change', () => setFilter({ ...filter, [el.name]: el.value }));
    }
    $('#q').addEventListener('input', (e) => setFilter({ ...filter, q: e.target.value }));
    $('#clear').addEventListener('click', () => setFilter({ ...DEFAULT_FILTER }));
    addEventListener('hashchange', () => { filter = parseHash(location.hash); update(); });
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !$('#detail').open) { e.preventDefault(); $('#q').focus(); }
    });
  }
  function setFilter(f) {
    filter = f;
    shown = 24;
    const hash = toHash(f);
    history.replaceState(null, '', hash || location.pathname + location.search);
    update();
  }

  // ----- lane chart -----
  let laneMax = 1;
  const laneRows = {};
  function buildLaneChart() {
    const ul = $('#lane-chart');
    for (const l of LANES) {
      const segs = ['free', 'paid', 'none'].map((k) => h('span', { class: `seg ${k}` }));
      const total = h('span', { class: 'lane-total' });
      const b = h('button', { type: 'button', class: 'lane-row', 'aria-pressed': 'false', onclick: () => toggleLane(l) },
        h('span', { class: 'lane-name' }, icon(l), LANE_NAMES[l]),
        h('span', { class: 'bar' }, segs),
        total);
      tipOn(b, () => {
        const c = laneRows[l].c;
        return [`${LANE_NAMES[l]}: ${c.total} rows`, `Free ${c.free}`, `Paid ${c.paid}`, `No set price ${c.none}`];
      });
      laneRows[l] = { b, segs, total, c: { free: 0, paid: 0, none: 0, total: 0 } };
      ul.append(h('li', null, b));
    }
  }
  function renderLaneChart(facet) {
    for (const l of LANES) {
      const c = facet[l];
      const r = laneRows[l];
      r.c = c;
      r.b.setAttribute('aria-pressed', String(filter.lanes.includes(l)));
      r.b.classList.toggle('dim', filter.lanes.length > 0 && !filter.lanes.includes(l));
      ['free', 'paid', 'none'].forEach((k, i) => {
        r.segs[i].style.setProperty('--w', c[k] / laneMax);
        r.segs[i].hidden = c[k] === 0;
      });
      r.total.textContent = String(c.total);
    }
    fillTable($('#lane-table'), ['Lane', 'Free', 'Paid', 'No set price', 'Total'],
      LANES.map((l) => [LANE_NAMES[l], facet[l].free, facet[l].paid, facet[l].none, facet[l].total]));
  }

  // ----- value chart -----
  function renderValueChart() {
    const list = valueRows(visible);
    const ul = $('#value-chart');
    const note = $('#value-note');
    ul.replaceChildren();
    const paid = visible.filter((r) => priceKind(r) === 'paid').length;
    note.textContent = list.length
      ? `${list.length} of ${paid} paid rows state a multiple.`
      : `No paid row in this filter states a multiple (${paid} paid).`;
    const max = Math.max(2, Math.ceil(Math.max(0, ...list.map((x) => x.multiple))));
    ul.style.setProperty('--max', max);
    $('#value-axis').replaceChildren(h('span', { class: 'axis-track' }, Array.from({ length: max }, (_, i) => h('span', { style: `--at:${(i + 1) / max}` }, `${i + 1}\u00D7`))));
    for (const { row, multiple } of list) {
      const b = h('button', { type: 'button', class: 'val-row', onclick: () => openRow(row.id) },
        h('span', { class: 'val-name', text: row.name }),
        h('span', { class: 'val-track' }, h('span', { class: 'val-fill', style: `--w:${multiple / max}` })),
        h('span', { class: 'val-num', text: `${+multiple.toFixed(2)}×` }));
      const p = priceText(row);
      tipOn(b, () => [row.name, `${+multiple.toFixed(2)}× pay as you go`, `${p.big}${p.small}`, row.unit_cost_vs_payg.slice(0, 140)]);
      ul.append(h('li', null, b));
    }
    ul.hidden = list.length === 0;
    $('#value-axis').hidden = list.length === 0;
    fillTable($('#value-table'), ['Plan', 'Price', 'Multiple'], list.map(({ row, multiple }) => [row.name, priceText(row).big + priceText(row).small, `${+multiple.toFixed(2)}×`]));
  }

  function fillTable(table, head, body) {
    table.replaceChildren(
      h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, body.map((row) => h('tr', null, row.map((c, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, text: String(c) }))))));
  }

  // ----- cards -----
  function pill(kind, label, iconName, title) {
    return h('span', { class: `pill ${kind}`, title }, icon(iconName), label);
  }
  function pillsFor(r) {
    const out = [];
    if (r.card === true) out.push(pill('', 'Card needed', 'card', 'The vendor asks for a card on file'));
    if (r.card === false) out.push(pill('', 'No card', 'check', 'No card on file needed'));
    if (r.overage === 'stops') out.push(pill('', 'Stops at limit', 'check', 'Service stops when the included amount runs out'));
    if (r.overage === 'bills') out.push(pill('warn', 'Bills past limit', 'warn', 'Use past the included amount is billed'));
    if (r.overage === 'unknown') out.push(pill('', 'Overage unclear', 'warn', 'The page does not say what happens at the limit'));
    return out;
  }
  const laneBadges = (r) => h('span', { class: 'lanes' }, r.lanes.map((l) => h('span', { class: 'badge', title: LANE_NAMES[l] }, icon(l), LANE_NAMES[l])));
  const readBadge = (r) => h('span', { class: 'read', title: r.verified ? 'Every figure was read on the vendor page on this date' : 'Not re-read since older research' },
    icon(r.verified ? 'verified' : 'unverified'), `read ${shortDate(r.checked)}`);
  const safeUrl = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : null);

  function card(r) {
    const p = priceText(r);
    const open = h('button', { type: 'button', class: 'card-open', onclick: () => openRow(r.id) }, h('span', { class: 'card-name', text: r.name }));
    const link = safeUrl(r.source);
    return h('li', null, h('article', { class: `card ${priceKind(r)}` },
      h('div', { class: 'card-top' }, laneBadges(r),
        h('span', { class: 'price' }, h('b', { text: p.big }), p.small ? h('small', { text: p.small }) : null)),
      h('h3', null, open),
      h('p', { class: 'provider', text: r.provider }),
      h('p', { class: 'includes', text: r.includes || '' }),
      h('div', { class: 'pills' }, pillsFor(r)),
      h('div', { class: 'card-foot' }, readBadge(r),
        link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Vendor page', icon('ext')) : null)));
  }
  function renderCards() {
    const ul = $('#cards');
    ul.replaceChildren(...visible.slice(0, shown).map(card));
    const more = $('#more');
    const left = visible.length - shown;
    more.hidden = left <= 0;
    more.textContent = `Show ${Math.min(24, Math.max(0, left))} more (${Math.max(0, left)} left)`;
    $('#empty').hidden = visible.length > 0;
  }

  // ----- detail dialog -----
  const dlg = $('#detail');
  function openRow(id) {
    const r = byId.get(id);
    if (!r) return;
    hideTip();
    const p = priceText(r);
    const fact = (k, v) => (v ? h('div', { class: 'fact' }, h('dt', { text: k }), h('dd', { text: v })) : null);
    const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : '');
    const links = [r.source, ...(r.sources_extra || [])].map(safeUrl).filter(Boolean);
    $('#d-body').replaceChildren(
      h('div', { class: 'card-top' }, laneBadges(r),
        h('span', { class: 'price big' }, h('b', { text: p.big }), p.small ? h('small', { text: p.small }) : null)),
      h('h1', { id: 'd-title', text: r.name }),
      h('p', { class: 'provider', text: r.provider_hq ? `${r.provider} (${r.provider_hq})` : r.provider }),
      h('p', { class: 'includes full', text: r.includes || '' }),
      h('div', { class: 'pills' }, pillsFor(r)),
      h('dl', { class: 'facts' },
        fact('Price', r.price_note),
        fact('Resets', r.resets),
        fact('Limits', r.limits),
        fact('Against pay as you go', r.unit_cost_vs_payg),
        fact('Trains on your data', yn(r.trains_on_data)),
        fact('Commercial use', yn(r.commercial_use))),
      h('div', { class: 'card-foot' }, readBadge(r),
        links.map((u, i) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, i === 0 ? 'Vendor page' : new URL(u).hostname, icon('ext')))));
    dlg.showModal();
  }
  function wireDialog() {
    // Light dismiss where closedby is missing (Safari): press and release both outside the box.
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
      let down = false;
      dlg.addEventListener('pointerdown', (e) => { down = outside(e); });
      dlg.addEventListener('pointerup', (e) => { if (down && outside(e)) dlg.close(); });
    }
  }

  // ----- theme -----
  function wireTheme() {
    const btn = $('#theme');
    const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
    const sync = () => { btn.setAttribute('aria-pressed', String(dark())); btn.setAttribute('aria-label', dark() ? 'Switch to light theme' : 'Switch to dark theme'); };
    btn.addEventListener('click', () => {
      const next = dark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('ce-theme', next); } catch { /* private window: the choice lasts until reload */ }
      sync();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
    sync();
  }

  // ----- the 3D view, after first paint -----
  function webgl() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }
  function noScene(why) {
    body.dataset.scene = 'off';
    $('#scene-note').textContent = why;
    $('#scene-note').hidden = false;
  }
  async function loadScene() {
    if (!webgl()) { noScene('3D needs WebGL, which this browser has off. The charts and cards show the same rows.'); return; }
    try {
      const [THREE, mod] = await Promise.all([import(body.dataset.three), import('./scene.js')]);
      scene = mod.createScene({
        THREE, host: $('#scene'), rows: all, lanes: LANES, laneNames: LANE_NAMES, reduced,
        onPick: openRow, onLane: toggleLane,
      });
      scene.setVisible(new Set(visible.map((r) => r.id)), filter.lanes);
      body.dataset.scene = 'on';
    } catch (err) {
      console.warn('3D view not started', err);
      noScene('The 3D view did not start. The charts and cards show the same rows.');
    }
  }
  function afterFirstPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1200 });
      else setTimeout(fn, 150);
    }));
  }

  // ----- update -----
  function update() {
    visible = applyFilter(all, filter);
    const facet = laneCounts(applyFilter(all, { ...filter, lanes: [] }));
    for (const l of LANES) chips[l].n.textContent = String(facet[l].total);
    $('#free .n').textContent = String(applyFilter(all, { ...filter, free: false }).filter((r) => priceKind(r) === 'free').length);
    syncControls();
    $('#status-n').textContent = String(visible.length);
    $('#status-all').textContent = String(all.length);
    renderTiles();
    renderLaneChart(facet);
    renderValueChart();
    renderCards();
    scene?.setVisible(new Set(visible.map((r) => r.id)), filter.lanes);
  }

  async function start() {
    initTiles();
    buildChips();
    buildLaneChart();
    wireControls();
    wireDialog();
    wireTheme();
    $('#more').addEventListener('click', () => { shown += 24; renderCards(); });
    try {
      const res = await fetch(body.dataset.plans, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      all = doc.rows;
    } catch (err) {
      $('#status').textContent = `Could not load ${body.dataset.plans} (${err.message}). Reload to try again.`;
      noScene('No data, so no 3D view.');
      return;
    }
    for (const r of all) byId.set(r.id, r);
    laneMax = Math.max(1, ...Object.values(laneCounts(all)).map((c) => c.total));
    $('#catalog-date').textContent = shortDate(all.reduce((m, r) => (r.checked > m ? r.checked : m), ''));
    update();
    body.classList.add('ready');
    afterFirstPaint(loadScene);
  }
  start();
}
