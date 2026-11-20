'use strict';
// escapeHtml unit tests, plus renderer tests: every render function that builds HTML is fed
// hostile file names / paths / error text, and the HTML it produces must contain no injected
// element or attribute and must show the text literally. The renderer modules are the real ones
// (src/renderer/js), loaded through the stub hooks used by renderer.test.js; DOM nodes are fakes.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT  = path.join(__dirname, '..');

// Snapshot loads arrive in chunks (snapshot:load + loadChunk + loadRelease); serve `pick(id)`
// ({ savedAt, tree }) through that API, one flattened tree per load.
const { flattenTree: _flatten, sliceChunk: _slice, chunkCount: _chunks } = require(path.join(ROOT, 'src/main/treeTransfer.js'));
function mockSnapshotLoads(pick) {
  const loads = new Map();
  let n = 0;
  globalThis.window.dt.loadSnapshot = async (id) => {
    const d = pick(id);
    const flat = _flatten(d.tree);
    const loadId = `ld-${++n}`;
    loads.set(loadId, flat);
    return { ok: true, meta: { id, rootPath: d.rootPath, savedAt: d.savedAt }, nodeCount: flat.nodes.length, chunkCount: _chunks(flat.nodes.length), loadId };
  };
  globalThis.window.dt.loadSnapshotChunk = async (loadId, i) => ({ ok: true, ..._slice(loads.get(loadId), i) });
  globalThis.window.dt.loadSnapshotRelease = async (loadId) => { loads.delete(loadId); };
}
const JS    = pathToFileURL(path.join(ROOT, 'src/renderer/js') + '/').href;
const STUBS = pathToFileURL(path.join(__dirname, 'stubs') + '/').href;

require('./registerEsmHooks.js');

// ── test helpers ─────────────────────────────────────────────────────────────
const HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "' onmouseover='alert(1)",
  '&amp;',
];

// Independent decoder (what the browser does with entities in attribute values).
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Every innerHTML assignment on any fake element (and on el.featurePanel) lands here.
let htmlLog = [];
const logged = (obj) => {
  let v = '';
  Object.defineProperty(obj, 'innerHTML', { get: () => v, set: (x) => { v = String(x); htmlLog.push(v); }, configurable: true });
};

const byId = new Map();
function makeEl(tag = 'div') {
  const e = {
    tag, style: {}, dataset: {}, className: '', textContent: '', disabled: false, checked: false,
    children: [], listeners: {}, _q: {}, parentNode: null, nextElementSibling: null,
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    addEventListener(ev, fn) { e.listeners[ev] = fn; },
    appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
    insertBefore(c) { c.parentNode = e; e.children.push(c); return c; },
    remove() {},
    closest() { return { remove() {} }; },
    querySelector(sel) {
      if (!e._q[sel]) {
        const c = makeEl();
        // Read-back: the browser decodes entities when a handler reads dataset.path.
        const m = /data-path="([^"]*)"/.exec(e.innerHTML);
        if (m) c.dataset.path = decode(m[1]);
        e._q[sel] = c;
      }
      return e._q[sel];
    },
  };
  logged(e);
  return e;
}
const fakeDocument = {
  getElementById(id) { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); },
  createElement: (tag) => makeEl(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.document = fakeDocument;
globalThis.alert = () => {};

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const html = () => htmlLog.join('\n');

// A hostile string must be neither a tag nor an attribute, and must appear literally (escaped).
function assertSafe(out, hostile, where) {
  assert.ok(out.includes(escapeHtml(hostile)), `${where}: escaped text of ${JSON.stringify(hostile)} missing`);
  if (/[<>"']/.test(hostile)) assert.ok(!out.includes(hostile), `${where}: raw ${JSON.stringify(hostile)} present`);
  const tags = out.match(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g) || [];
  for (const t of tags) {
    assert.ok(!/^<\/?(img|svg|script|iframe)\b/i.test(t), `${where}: injected tag ${t}`);
    // Quoted attribute values are inert text; anything else that looks like a handler is injected.
    const bare = t.replace(/"[^"]*"|'[^']*'/g, '""');
    assert.ok(!/\son[a-z]+\s*=/i.test(bare), `${where}: injected handler in ${t}`);
  }
}

let escapeHtml, S, el, tl, dup, junk, snaps;
test.before(async () => {
  ({ escapeHtml } = await import(JS + 'escape.js'));
  S = (await import(STUBS + 'state.js')).S;
  el = (await import(STUBS + 'elements.js')).el;
  logged(el.featurePanel);
  tl = await import(JS + 'toplist.js');
  dup = await import(JS + 'duplicates.js');
  junk = await import(JS + 'junk.js');
  snaps = await import(JS + 'snapshots.js');
});

function reset() {
  htmlLog = [];
  byId.clear();
  S.tree = null; S.rootPath = ''; S.expanded.clear();
}

const mkFile = (name, p, size = 5, mtime = 1) => ({ name, path: p, isDir: false, size, allocated: size, files: 1, folders: 0, mtime, atime: 0, ext: '', error: false, children: null });
const mkRoot = (children) => ({ name: 'root', path: '/r', isDir: true, size: 100, allocated: 100, files: children.length, folders: 0, mtime: 1, ext: '', error: false, children });

// ── escapeHtml ───────────────────────────────────────────────────────────────
test('escapeHtml: escapes & < > " \'', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml: & is escaped once, not twice', () => {
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml: every occurrence is escaped, not just the first', () => {
  assert.equal(escapeHtml('a&b&c'), 'a&amp;b&amp;c');
  assert.equal(escapeHtml('<<>>'), '&lt;&lt;&gt;&gt;');
  assert.equal(escapeHtml('""\'\''), '&quot;&quot;&#39;&#39;');
});

test('escapeHtml: plain text and unicode pass through unchanged', () => {
  assert.equal(escapeHtml('plain name.txt'), 'plain name.txt');
  assert.equal(escapeHtml('/Users/me/Dokumente/Übung ✓.txt'), '/Users/me/Dokumente/Übung ✓.txt');
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: non-strings are converted with String()', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
  assert.equal(escapeHtml({ toString: () => '<b>' }), '&lt;b&gt;');
});

test('escapeHtml: round trip through an entity decoder returns the input', () => {
  for (const h of HOSTILE) assert.equal(decode(escapeHtml(h)), h);
});

// ── toplist.js ───────────────────────────────────────────────────────────────
for (const h of HOSTILE) {
  test(`toplist: Top 100 shows ${JSON.stringify(h)} literally`, () => {
    reset();
    S.tree = mkRoot([mkFile(`n${h}.bin`, `/r/p${h}/n${h}.bin`)]);
    tl.renderTop100Panel();
    const out = html();
    assertSafe(out, `n${h}.bin`, 'name');
    assertSafe(out, `/r/p${h}/n${h}.bin`, 'path');
  });

  test(`toplist: Forgotten files shows ${JSON.stringify(h)} literally`, () => {
    reset();
    S.tree = mkRoot([mkFile(`n${h}.bin`, `/r/p${h}/n${h}.bin`, 500 * 1024 * 1024, 1)]);
    tl.renderForgottenPanel();
    const out = html();
    assert.ok(out.includes('1 forgotten files found'));
    assertSafe(out, `n${h}.bin`, 'name');
    assertSafe(out, `/r/p${h}/n${h}.bin`, 'path');
  });
}

test('toplist: Delete button reads the exact original path back from data-path', async () => {
  reset();
  const p = `/r/${HOSTILE.join('')}/f.bin`;
  S.tree = mkRoot([mkFile('f.bin', p)]);
  const deleted = [];
  globalThis.window = { dt: { deleteItems: async (ps) => { deleted.push(...ps); return { deleted: [] }; } } };
  const btnHtml = (() => { tl.renderTop100Panel(); return html(); })();
  const m = /class="panel-btn panel-btn-danger top-btn-del" data-path="([^"]*)"/.exec(btnHtml);
  assert.ok(m, 'delete button present');
  const btn = { dataset: { path: decode(m[1]) }, closest: () => ({ remove() {} }) };
  fakeDocument.querySelectorAll = (sel) => (sel === '.top-btn-del' ? [{ addEventListener: (ev, fn) => fn({ target: btn }) }] : []);
  try {
    tl.renderTop100Panel();
    await tick();
  } finally { fakeDocument.querySelectorAll = () => []; }
  assert.deepEqual(deleted, [p]);
});

// ── duplicates.js ────────────────────────────────────────────────────────────
function dupWindow(over = {}) {
  globalThis.window = {
    dt: {
      onDupProgress() {}, offDupProgress() {}, cancelDuplicates() {},
      findDuplicates: async () => ({ ok: true, groups: [] }),
      getThumbnail: async () => null,
      deleteItems: async () => ({ deleted: [] }),
      ...over,
    },
  };
}

for (const h of HOSTILE) {
  test(`duplicates: error text ${JSON.stringify(h)} is shown literally`, async () => {
    reset();
    S.tree = mkRoot([mkFile('a', '/r/a'), mkFile('b', '/r/b')]);
    dupWindow({ findDuplicates: async () => ({ ok: false, error: `E${h}` }) });
    await dup.renderDuplicatesPanel();
    assertSafe(html(), `E${h}`, 'error');
  });

  test(`duplicates: group rows show path ${JSON.stringify(h)} literally`, async () => {
    reset();
    S.tree = mkRoot([mkFile('a', '/r/a'), mkFile('b', '/r/b')]);
    const p1 = `/r/p${h}/a.bin`, p2 = `/r/q${h}/b.bin`;
    dupWindow({ findDuplicates: async () => ({ ok: true, groups: [{ hash: 'h', size: 5, files: [{ path: p1, mtime: 2 }, { path: p2, mtime: 1 }] }] }) });
    await dup.renderDuplicatesPanel();
    const out = html();
    assertSafe(out, p1, 'path 1');
    assertSafe(out, p2, 'path 2');
  });
}

test('duplicates: checkbox reads the exact original path back (selection + delete)', async () => {
  reset();
  S.tree = mkRoot([mkFile('a', '/r/a'), mkFile('b', '/r/b')]);
  const p1 = `/r/${HOSTILE.join('')}/new.bin`, p2 = `/r/${HOSTILE.join('')}/old.bin`;
  const deleted = [];
  dupWindow({
    findDuplicates: async () => ({ ok: true, groups: [{ hash: 'h', size: 5, files: [{ path: p1, mtime: 2 }, { path: p2, mtime: 1 }] }] }),
    deleteItems: async (ps) => { deleted.push(...ps); return { deleted: [] }; },
  });
  const created = [];
  const origCreate = fakeDocument.createElement;
  fakeDocument.createElement = (tag) => { const e = origCreate(tag); created.push(e); return e; };
  try { await dup.renderDuplicatesPanel(); } finally { fakeDocument.createElement = origCreate; }
  // default 'newest' keeps p1 selected for deletion = p2. Uncheck p2 via its checkbox, then check it again.
  const rows = created.filter(e => e.className === 'dup-item-row');
  assert.equal(rows.length, 2);
  const oldRow = rows.find(r => decode(/data-path="([^"]*)"/.exec(r.innerHTML)[1]) === encodeURIComponent(p2));
  assert.ok(oldRow, 'old row present and data-path is the encoded original path');
  const cb = oldRow.querySelector('.dup-checkbox');
  assert.equal(decodeURIComponent(cb.dataset.path), p2);
  fakeDocument.querySelector = () => null;
  cb.listeners.change({ target: { checked: false, dataset: cb.dataset } });
  // After unchecking, nothing is selected, so the clean button is disabled; re-check selects p2 again.
  cb.listeners.change({ target: { checked: true, dataset: cb.dataset } });
  await byId.get('dup-btn-clean').listeners.click();
  assert.deepEqual(deleted, [p2]);
});

test('duplicates: thumbnail strip escapes path and data URL', async () => {
  reset();
  S.tree = mkRoot([mkFile('a', '/r/a'), mkFile('b', '/r/b')]);
  const p1 = '/r/<img src=x onerror=alert(1)>.png', p2 = '/r/b.png';
  const thumb = 'data:image/png;base64,"><svg onload=alert(1)>';
  dupWindow({
    findDuplicates: async () => ({ ok: true, groups: [{ hash: 'h', size: 5, files: [{ path: p1, mtime: 1 }, { path: p2, mtime: 2 }] }] }),
    getThumbnail: async () => thumb,
  });
  const created = [];
  const origCreate = fakeDocument.createElement;
  fakeDocument.createElement = (tag) => { const e = origCreate(tag); created.push(e); return e; };
  try { await dup.renderDuplicatesPanel(); } finally { fakeDocument.createElement = origCreate; }
  const row = created.find(e => e.className === 'dup-item-row');
  row.parentNode = makeEl();
  htmlLog = [];
  await row.listeners.mouseenter();
  const out = html();
  assert.equal(out.split('<img').length - 1, 1, 'exactly the one thumbnail img');
  assert.ok(out.includes('<img class="dup-thumb" src="'), 'thumbnail rendered');
  const rest = out.replace('<img class="dup-thumb"', '<span'); // the intended img; everything else is checked
  assertSafe(rest, p1, 'thumb path');
  assertSafe(rest, thumb, 'thumb src');
});

// ── junk.js ──────────────────────────────────────────────────────────────────
for (const h of HOSTILE) {
  test(`junk: scan root ${JSON.stringify(h)} is shown literally while scanning`, async () => {
    reset();
    S.rootPath = `/r${h}`;
    globalThis.window = { dt: { onJunkProgress() {}, offJunkProgress() {}, cancelJunk() {}, scanJunk: async () => ({ ok: true, items: [] }) } };
    await junk.renderJunkPanel();
    assertSafe(html(), `/r${h}`, 'root');
  });

  test(`junk: error text ${JSON.stringify(h)} is shown literally`, async () => {
    reset();
    S.rootPath = '/r';
    globalThis.window = { dt: { onJunkProgress() {}, offJunkProgress() {}, cancelJunk() {}, scanJunk: async () => ({ ok: false, error: `E${h}` }) } };
    await junk.renderJunkPanel();
    assertSafe(html(), `E${h}`, 'error');
  });

  test(`junk: item rows show path/category/kind ${JSON.stringify(h)} literally`, async () => {
    reset();
    S.rootPath = '/r';
    const item = { path: `/r/p${h}`, category: `C${h}`, kind: `K${h}`, size: 7, badge: 'safe' };
    globalThis.window = { dt: { onJunkProgress() {}, offJunkProgress() {}, cancelJunk() {}, scanJunk: async () => ({ ok: true, items: [item] }) } };
    await junk.renderJunkPanel();
    const out = html();
    assertSafe(out, item.path, 'path');
    assertSafe(out, item.category, 'category');
    assertSafe(out, item.kind, 'kind');
  });
}

test('junk: checkbox reads the exact original path back (clean deletes it)', async () => {
  reset();
  S.rootPath = '/r';
  const p = `/r/${HOSTILE.join('')}`;
  const deleted = [];
  globalThis.window = { dt: { onJunkProgress() {}, offJunkProgress() {}, cancelJunk() {}, scanJunk: async () => ({ ok: true, items: [{ path: p, category: 'c', kind: 'k', size: 1, badge: 'caution' }] }), deleteItems: async (ps) => { deleted.push(...ps); return { deleted: [] }; } } };
  const created = [];
  const origCreate = fakeDocument.createElement;
  fakeDocument.createElement = (tag) => { const e = origCreate(tag); created.push(e); return e; };
  try { await junk.renderJunkPanel(); } finally { fakeDocument.createElement = origCreate; }
  const row = created.find(e => e.className === 'junk-row');
  const cb = row.querySelector('.junk-checkbox');
  assert.equal(decodeURIComponent(cb.dataset.path), p);
  cb.listeners.change({ target: { checked: true, dataset: cb.dataset } }); // selects p, re-renders
  await byId.get('junk-btn-clean').listeners.click();
  assert.deepEqual(deleted, [p]);
});

// ── snapshots.js ─────────────────────────────────────────────────────────────
async function renderSnapshotList(list) {
  globalThis.window = { dt: { listSnapshots: async () => ({ ok: true, list }) } };
  await snaps.renderSnapshotsPanel();
  await tick();
}

for (const h of HOSTILE) {
  test(`snapshots: list row shows rootPath/id/count ${JSON.stringify(h)} literally`, async () => {
    reset();
    const created = [];
    const origCreate = fakeDocument.createElement;
    fakeDocument.createElement = (tag) => { const e = origCreate(tag); created.push(e); return e; };
    try { await renderSnapshotList([{ id: `snap-1${h}`, rootPath: `/r${h}`, savedAt: 1, totalSize: 5, files: `3${h}` }]); } finally { fakeDocument.createElement = origCreate; }
    const out = html();
    assertSafe(out, `/r${h}`, 'rootPath');
    assertSafe(out, `snap-1${h}`, 'id');
    assertSafe(out, `3${h}`, 'file count');
  });

  test(`snapshots: diff table shows path ${JSON.stringify(h)} literally`, async () => {
    reset();
    await renderSnapshotList([{ id: 'snap-1', rootPath: '/r', savedAt: 1, totalSize: 5, files: 1 }, { id: 'snap-2', rootPath: '/r', savedAt: 2, totalSize: 9, files: 2 }]);
    const treeFor = (savedAt, size) => ({ savedAt, tree: { path: '/r', name: 'r', isDir: true, size, children: [{ path: `/r/p${h}`, name: 'x', isDir: false, size }] } });
    mockSnapshotLoads((id) => id === 'snap-1' ? treeFor(1, 5) : treeFor(2, 9));
    for (const row of byId.get('snapshot-items').children) {
      const cb = row.querySelector('.snap-cb');
      cb.listeners.change({ target: { checked: true } });
    }
    await byId.get('snap-btn-compare').listeners.click();
    await tick();
    assertSafe(byId.get('diff-results-card').innerHTML, `/r/p${h}`, 'diff path');
  });
}

// ── fmt (real format.js) and snapshot sizes read from files ──────────────────
const HOSTILE_SIZES = ['<img src=x onerror=alert(1)>', ['<img src=x onerror=alert(1)>'], { toString: () => '<svg onload=alert(1)>' }, 'Infinity', NaN, Infinity, {}];

test('format.fmt (real): numbers are formatted exactly as before in every unit mode', async () => {
  const { fmt } = await import(JS + 'format.js');
  const want = {
    b: [`${(1500).toLocaleString()} B`, '0 B'], kb: ['1.5 KB', '0.0 KB'], mb: ['0.0 MB', '0.0 MB'], gb: ['0.00 GB', '0.00 GB'],
    auto: ['1.5 KB', '0 B'],
  };
  for (const [mode, [a, z]] of Object.entries(want)) {
    S.unitMode = mode === 'auto' ? undefined : mode;
    assert.equal(fmt(1500), mode === 'kb' ? '1.5 KB' : a, mode);
    assert.equal(fmt(0), z, mode);
  }
  S.unitMode = undefined;
  assert.equal(fmt(5 * 1024 ** 2), '5.0 MB');
  assert.equal(fmt(3 * 1024 ** 3), '3.00 GB');
  assert.equal(fmt(2048), '2.0 KB');
  assert.equal(fmt('2048'), '2.0 KB'); // numeric strings still format
  assert.equal(fmt(null), '—');
  assert.equal(fmt(undefined), '—');
});

test('format.fmt (real): non-numeric input never comes back as text, in unit mode b too', async () => {
  const { fmt } = await import(JS + 'format.js');
  for (const mode of ['b', 'kb', 'mb', 'gb', undefined]) {
    S.unitMode = mode;
    for (const bad of HOSTILE_SIZES) assert.equal(fmt(bad), '—', `${mode} ${String(bad)}`);
  }
  S.unitMode = undefined;
});

for (const bad of HOSTILE_SIZES.slice(0, 2)) {
  test(`snapshots: hostile totalSize ${JSON.stringify(String(bad))} with the real fmt in unit mode b injects nothing`, async () => {
    reset();
    const { fmt } = await import(JS + 'format.js');
    S.unitMode = 'b'; globalThis.__fmt = fmt;
    try {
      await renderSnapshotList([{ id: 'snap-1', rootPath: '/r', savedAt: 1, totalSize: bad, files: 1 }]);
    } finally { globalThis.__fmt = undefined; S.unitMode = undefined; }
    const out = html();
    assert.ok(!/<(img|svg)/i.test(out), 'no injected element');
    assert.ok(out.includes('—'), 'shown as a dash');
  });
}

for (const bad of ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>']) {
  test(`snapshots: fmt output is escaped on its own (layer b) for ${JSON.stringify(bad)}`, async () => {
    reset(); // stub fmt echoes its input, as the unfixed real fmt did
    await renderSnapshotList([{ id: 'snap-1', rootPath: '/r', savedAt: 1, totalSize: bad, files: 1 }, { id: 'snap-2', rootPath: '/r', savedAt: 2, totalSize: 1, files: 1 }]);
    assertSafe(html(), bad, 'totalSize');
  });
}

test('snapshots: diff sizes are escaped even if fmt echoes them (layer b)', async () => {
  reset();
  await renderSnapshotList([{ id: 'snap-1', rootPath: '/r', savedAt: 1, totalSize: 1, files: 1 }, { id: 'snap-2', rootPath: '/r', savedAt: 2, totalSize: 2, files: 1 }]);
  const evil = { valueOf: () => 7, toString: () => '<img src=x onerror=alert(1)>' }; // > 0, prints as markup
  const mk = (savedAt, size) => ({ savedAt, tree: { path: '/r', name: 'r', isDir: true, size: 0, children: [{ path: '/r/f', name: 'f', isDir: false, size }] } });
  mockSnapshotLoads((id) => id === 'snap-1' ? mk(1, evil) : mk(2, 9));
  for (const row of byId.get('snapshot-items').children) row.querySelector('.snap-cb').listeners.change({ target: { checked: true } });
  await byId.get('snap-btn-compare').listeners.click();
  await tick();
  const out = byId.get('diff-results-card').innerHTML;
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'), 'sizeA shown literally');
  assert.ok(!/<img/i.test(out));
  // and sizeB
  mockSnapshotLoads((id) => id === 'snap-1' ? mk(1, 9) : mk(2, evil));
  await byId.get('snap-btn-compare').listeners.click();
  await tick();
  const out2 = byId.get('diff-results-card').innerHTML;
  assert.ok(out2.includes('&lt;img src=x onerror=alert(1)&gt;'), 'sizeB shown literally');
  assert.ok(!/<img/i.test(out2));
});

test('CSP: script-src has no unsafe-inline, style-src keeps it, no inline scripts or handlers', () => {
  const page = require('node:fs').readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const csp = /Content-Security-Policy"\s+content="([^"]*)"/.exec(page)[1];
  const script = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  assert.equal(script, "script-src 'self'");
  assert.ok(csp.split(';').map(s => s.trim()).some(s => s === "style-src 'self' 'unsafe-inline'"));
  assert.equal((page.match(/<script\b[^>]*>/gi) || []).filter(t => !/\ssrc=/.test(t)).length, 0);
  assert.equal(/\son[a-z]+\s*=/i.test(page.replace(/<!--[\s\S]*?-->/g, '')), false);
});
