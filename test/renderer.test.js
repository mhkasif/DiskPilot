'use strict';
// Runs the real src/renderer/js/scan.js and snapshots.js against fake DOM-dependent modules
// (test/stubs) and a fake window.dt, to pin the renderer side of the chunked transfer.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT  = path.join(__dirname, '..');
const JS    = pathToFileURL(path.join(ROOT, 'src/renderer/js') + '/').href;
const STUBS = pathToFileURL(path.join(__dirname, 'stubs') + '/').href;

require('./registerEsmHooks.js');

const codec = require(path.join(ROOT, 'src/main/treeTransfer.js'));

let scan, snaps, S, el, statusLog;
const store = new Map();
globalThis.sessionStorage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) };
globalThis.alerts = [];
globalThis.alert = (m) => globalThis.alerts.push(m);
const buttons = {};
const makeButton = () => { const b = { disabled: false, listeners: {}, addEventListener(ev, fn) { b.listeners[ev] = fn; }, innerHTML: '', appendChild(c) { (b.appended ??= []).push(c); } }; return b; };
const makeRow = () => { const kids = {}; const r = { style: {}, className: '', innerHTML: '', querySelector: (sel) => (kids[sel] ??= makeButton()), kids }; return r; };
globalThis.document = { getElementById: (id) => (buttons[id] ??= makeButton()), createElement: () => makeRow() };

test.before(async () => {
  scan = await import(JS + 'scan.js');
  snaps = await import(JS + 'snapshots.js');
  S = (await import(STUBS + 'state.js')).S;
  el = (await import(STUBS + 'elements.js')).el;
  statusLog = (await import(STUBS + 'statusBar.js')).statusLog;
});

const file = (name, size) => ({ name, path: `/r/${name}`, isDir: false, size, allocated: size, files: 1, folders: 0, mtime: 1, ext: '', error: false, children: null });
const dir = (name, children) => ({ name, path: `/r/${name}`, isDir: true, size: 10, allocated: 10, files: 2, folders: 0, mtime: 1, ext: '', error: false, children });
const sampleTree = () => dir('root', [file('a', 5), file('b', 5)]);

// Fake snapshot store: snapshot id -> { meta, tree }; the loadId is 'L-<id>'.
const snapStore = {};
const snapFlat = (loadId) => codec.flattenTree(snapStore[loadId.slice(2)].tree);
const loadReply = (id) => {
  const snap = snapStore[id];
  if (!snap) return { ok: false, error: 'ENOENT' };
  const n = codec.flattenTree(snap.tree).nodes.length;
  return { ok: true, meta: snap.meta, nodeCount: n, chunkCount: codec.chunkCount(n, 1), loadId: `L-${id}` };
};

function fakeDt(over = {}) {
  const log = { released: [], chunks: [], aborted: [], saved: [], committed: [], loadChunks: [], loadReleased: [] };
  const flat = codec.flattenTree(sampleTree());
  const dt = {
    trackEvent() {},
    scan: async (p, id) => ({ ok: true, scanId: id, nodeCount: flat.nodes.length, chunkCount: codec.chunkCount(flat.nodes.length, 1) }),
    scanChunk: async (id, i) => { log.chunks.push(i); const c = codec.sliceChunk(flat, i, 1); return { ok: true, ...c }; },
    releaseScan: (id) => { log.released.push(id); },
    cancelScan() {},
    saveSnapshotBegin: async (m) => ({ ok: true, uploadId: 'U1' }),
    saveSnapshotChunk: async (id, c) => { log.saved.push(c); return { ok: true }; },
    saveSnapshotCommit: async (id) => { log.committed.push(id); return { ok: true, id: 'snap-1', savedAt: 1 }; },
    saveSnapshotAbort: (id) => { log.aborted.push(id); },
    listSnapshots: async () => ({ ok: true, list: [] }),
    loadSnapshot: async (id) => loadReply(id),
    loadSnapshotChunk: async (loadId, i) => { log.loadChunks.push([loadId, i]); const c = codec.sliceChunk(snapFlat(loadId), i, 1); return c ? { ok: true, ...c } : { ok: false, error: 'bad index' }; },
    loadSnapshotRelease: (loadId) => { log.loadReleased.push(loadId); },
    ...over,
  };
  globalThis.window = { dt };
  return { dt, log };
}

function reset() {
  S.tree = null; S.scanning = false; S.scanId = null; S.expanded.clear();
  statusLog.length = 0; globalThis.alerts.length = 0;
}

// ── scan.js ──────────────────────────────────────────────────────────────────
test('scan: chunks are pulled in order, tree rebuilt, scan released once', async () => {
  reset();
  const { log } = fakeDt();
  await scan.triggerScan('/r');
  assert.deepEqual(log.chunks, [0, 1, 2]);
  assert.deepEqual(S.tree, sampleTree());
  assert.equal(S.scanning, false);
  assert.equal(log.released.length, 1);
  assert.ok(log.released[0].startsWith('scan-'));
  assert.equal(S.scanId, log.released[0]);
  assert.equal(statusLog.at(-1), 'Scan complete');
  assert.ok(statusLog.includes('Loading results… 0/3'));
  assert.ok(statusLog.includes('Loading results… 2/3'));
  assert.equal(el.treeWrap.style.display, 'flex');
  assert.equal(S.expanded.has('/r/root'), true);
});

test('scan: node count mismatch is an error, nothing is shown, scan released', async () => {
  reset();
  const { log } = fakeDt({ scan: async (p, id) => ({ ok: true, scanId: id, nodeCount: 4, chunkCount: 3 }) });
  await scan.triggerScan('/r');
  assert.equal(S.tree, null);
  assert.equal(S.scanning, false);
  assert.equal(S.scanId, null);
  assert.match(statusLog.at(-1), /^Error: /);
  assert.equal(el.stateEmpty.style.display, 'flex');
  assert.equal(el.btnScan.disabled, false);
  assert.equal(log.released.length, 1);
});

test('scan: a failed chunk is an error, scan released', async () => {
  reset();
  const { log } = fakeDt({ scanChunk: async (id, i) => (i === 1 ? { ok: false, error: 'gone' } : { ok: true, nodes: [], parents: [] }) });
  await scan.triggerScan('/r');
  assert.equal(S.tree, null);
  assert.equal(statusLog.at(-1), 'Error: gone');
  assert.equal(S.scanning, false);
  assert.equal(log.released.length, 1);
});

test('scan: a throwing chunk call is an error (no stuck "Loading results")', async () => {
  reset();
  const { log } = fakeDt({ scanChunk: async () => { throw new Error('boom'); } });
  await scan.triggerScan('/r');
  assert.equal(statusLog.at(-1), 'Error: boom');
  assert.equal(S.scanning, false);
  assert.equal(el.btnScan.disabled, false);
  assert.equal(log.released.length, 1);
});

test('scan: a chunk failure with no message says Unknown', async () => {
  reset();
  fakeDt({ scanChunk: async () => ({ ok: false }) });
  await scan.triggerScan('/r');
  assert.equal(statusLog.at(-1), 'Error: Unknown');
});

test('scan: cancel while loading returns silently and still releases', async () => {
  reset();
  const { log } = fakeDt({
    scanChunk: async (id, i) => {
      if (i === 1) scan.cancelScan();
      return { ok: true, nodes: [], parents: [] };
    },
  });
  await scan.triggerScan('/r');
  assert.equal(S.tree, null);
  assert.equal(statusLog.at(-1), 'Scan cancelled.');
  assert.equal(log.released.length, 1);
});

test('scan: a scan superseded while loading does not touch the newer scan state', async () => {
  reset();
  const { log } = fakeDt({
    scanChunk: async (id, i) => {
      if (i === 0) { S.scanId = 'scan-other'; }
      return { ok: true, nodes: [], parents: [] };
    },
  });
  await scan.triggerScan('/r');
  assert.equal(S.scanId, 'scan-other'); // untouched
  assert.equal(S.tree, null);
  assert.equal(log.released.length, 1);
});

test('scan: main-side failure shows the error and does not release', async () => {
  reset();
  const { log } = fakeDt({ scan: async () => ({ ok: false, error: 'nope' }) });
  await scan.triggerScan('/r');
  assert.equal(statusLog.at(-1), 'Error: nope');
  assert.equal(log.released.length, 0);
  assert.equal(S.scanning, false);
});

const tick = (ms = 4) => new Promise(r => setTimeout(r, ms)); // scan ids are Date.now() based
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('scan: the cancelled reply of a superseded scan does not break the newer scan', async () => {
  reset();
  const first = deferred();
  const gate = deferred();
  let calls = 0;
  const flat = codec.flattenTree(sampleTree());
  const ids = [];
  const { log } = fakeDt({
    scan: (p, id) => {
      ids.push(id);
      if (++calls === 1) return first.promise;
      return Promise.resolve({ ok: true, scanId: id, nodeCount: flat.nodes.length, chunkCount: 3 });
    },
    scanChunk: async (id, i) => {
      if (i === 0) await gate.promise;
      return { ok: true, ...codec.sliceChunk(flat, i, 1) };
    },
  });
  const p1 = scan.triggerScan('/r');
  await tick();
  const p2 = scan.triggerScan('/r');
  await tick();
  first.resolve({ ok: false, cancelled: true }); // old scan reports back while the new one loads
  await tick();
  gate.resolve();
  await Promise.all([p1, p2]);
  assert.deepEqual(S.tree, sampleTree());
  assert.equal(S.scanning, false);
  assert.equal(statusLog.at(-1), 'Scan complete');
  assert.equal(statusLog.includes('Scan cancelled.'), false);
  assert.equal(log.released.length, 1);
});

test('scan: a stale ok reply neither loads chunks nor overwrites the newer headline, and is released', async () => {
  reset();
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const flat = codec.flattenTree(sampleTree());
  const ids = [];
  const { log } = fakeDt({
    scan: (p, id) => { ids.push(id); return ++calls === 1 ? first.promise : second.promise; },
  });
  const p1 = scan.triggerScan('/r');
  await tick();
  const p2 = scan.triggerScan('/r');
  await tick();
  assert.equal(el.scanHeadline.textContent, 'Scanning…');
  first.resolve({ ok: true, scanId: ids[0], nodeCount: flat.nodes.length, chunkCount: 3 });
  await p1;
  assert.equal(el.scanHeadline.textContent, 'Scanning…');
  assert.deepEqual(log.chunks, []);
  assert.deepEqual(log.released, [ids[0]]);
  assert.equal(S.scanId, ids[1]);
  assert.equal(S.scanning, true);
  second.resolve({ ok: true, scanId: ids[1], nodeCount: flat.nodes.length, chunkCount: 3 });
  await p2;
  assert.deepEqual(S.tree, sampleTree());
  assert.deepEqual(log.released, [ids[0], ids[1]]);
});

test('scan: a cancelled reply after the user cancelled does nothing more', async () => {
  reset();
  const first = deferred();
  fakeDt({ scan: () => first.promise });
  const p = scan.triggerScan('/r');
  await tick();
  scan.cancelScan();
  statusLog.length = 0;
  first.resolve({ ok: false, cancelled: true });
  await p;
  assert.deepEqual(statusLog, []);
});

test('scan: a chunk call that rejects after a cancel leaves state and status alone', async () => {
  reset();
  fakeDt({ scanChunk: async () => { scan.cancelScan(); throw new Error('late boom'); } });
  await scan.triggerScan('/r');
  assert.equal(statusLog.at(-1), 'Scan cancelled.');
  assert.equal(statusLog.some(m => m.startsWith('Error:')), false);
});

test('scan: a chunk call that rejects after being superseded leaves the newer scan alone', async () => {
  reset();
  fakeDt({ scanChunk: async () => { S.scanId = 'scan-newer'; throw new Error('late boom'); } });
  await scan.triggerScan('/r');
  assert.equal(S.scanId, 'scan-newer');
  assert.equal(S.scanning, true);
  assert.equal(statusLog.some(m => m.startsWith('Error:')), false);
  assert.equal(el.btnScan.disabled, true);
});

// ── snapshots.js ─────────────────────────────────────────────────────────────
async function clickSave() {
  S.tree = sampleTree(); S.rootPath = '/r';
  for (const k of Object.keys(buttons)) delete buttons[k];
  await snaps.renderSnapshotsPanel();
  const btn = buttons['snap-btn-save'];
  return { btn, click: () => btn.listeners.click() };
}

test('snapshot save: success uploads all chunks, commits, never aborts, re-enables button', async () => {
  reset();
  const { log } = fakeDt();
  const { btn, click } = await clickSave();
  const p = click();
  assert.equal(btn.disabled, true);
  await p;
  assert.equal(btn.disabled, false);
  assert.equal(log.saved.length, 1);
  assert.deepEqual(log.committed, ['U1']);
  assert.deepEqual(log.aborted, []);
  assert.equal(globalThis.alerts.length, 0);
});

test('snapshot save: a failed chunk aborts the upload, alerts, re-enables the button', async () => {
  reset();
  const { log } = fakeDt({ saveSnapshotChunk: async () => ({ ok: false, error: 'bad chunk' }) });
  const { btn, click } = await clickSave();
  await click();
  assert.deepEqual(log.aborted, ['U1']);
  assert.deepEqual(log.committed, []);
  assert.deepEqual(globalThis.alerts, ['Failed to save snapshot: bad chunk']);
  assert.equal(btn.disabled, false);
});

test('snapshot save: a throwing chunk call aborts and reports the message', async () => {
  reset();
  const { log } = fakeDt({ saveSnapshotChunk: async () => { throw new Error('ipc down'); } });
  const { btn, click } = await clickSave();
  await click();
  assert.deepEqual(log.aborted, ['U1']);
  assert.deepEqual(globalThis.alerts, ['Failed to save snapshot: ipc down']);
  assert.equal(btn.disabled, false);
});

test('snapshot save: a failed begin neither uploads nor aborts', async () => {
  reset();
  const { log } = fakeDt({ saveSnapshotBegin: async () => ({ ok: false, error: 'no' }) });
  const { btn, click } = await clickSave();
  await click();
  assert.deepEqual(log.saved, []);
  assert.deepEqual(log.aborted, []);
  assert.deepEqual(globalThis.alerts, ['Failed to save snapshot: no']);
  assert.equal(btn.disabled, false);
});

test('snapshot save: a failed commit is reported and does not abort (commit consumed the upload)', async () => {
  reset();
  const { log } = fakeDt({ saveSnapshotCommit: async () => ({ ok: false, error: 'disk full' }) });
  const { btn, click } = await clickSave();
  await click();
  assert.deepEqual(log.aborted, []);
  assert.deepEqual(globalThis.alerts, ['Failed to save snapshot: disk full']);
  assert.equal(btn.disabled, false);
});

test('snapshot save: success refreshes the list', async () => {
  reset();
  let lists = 0;
  fakeDt({ listSnapshots: async () => { lists++; return { ok: true, list: [] }; } });
  const { click } = await clickSave();
  const before = lists;
  await click();
  assert.equal(lists, before + 1);
});

// ── snapshots.js: chunked load ───────────────────────────────────────────────
const metaOf = (id, savedAt) => ({ id, rootPath: '/r', savedAt, version: '1.0.0' });
function putSnap(id, savedAt, tree) { snapStore[id] = { meta: metaOf(id, savedAt), tree }; }

test('snapshot load: gives callers {version,id,rootPath,savedAt,tree} like before, pulls chunks in order, releases once', async () => {
  reset();
  putSnap('snap-1', 5, sampleTree());
  const { log } = fakeDt();
  const res = await snaps.loadSnapshotChunked('snap-1');
  assert.deepEqual(res, { ok: true, data: { id: 'snap-1', rootPath: '/r', savedAt: 5, version: '1.0.0', tree: sampleTree() } });
  assert.deepEqual(log.loadChunks, [['L-snap-1', 0], ['L-snap-1', 1], ['L-snap-1', 2]]);
  assert.deepEqual(log.loadReleased, ['L-snap-1']);
});

test('snapshot load: a failed begin returns the reply and releases nothing', async () => {
  reset();
  const { log } = fakeDt();
  const res = await snaps.loadSnapshotChunked('snap-missing');
  assert.deepEqual(res, { ok: false, error: 'ENOENT' });
  assert.deepEqual(log.loadChunks, []);
  assert.deepEqual(log.loadReleased, []);
});

test('snapshot load: a failed chunk gives ok:false with its message, stops pulling, releases', async () => {
  reset();
  putSnap('snap-2', 5, sampleTree());
  const { log } = fakeDt({ loadSnapshotChunk: async (l, i) => { log0.push(i); return i === 1 ? { ok: false, error: 'gone' } : { ok: true, ...codec.sliceChunk(snapFlat(l), i, 1) }; } });
  const log0 = []; // chunk indexes requested
  const res = await snaps.loadSnapshotChunked('snap-2');
  assert.deepEqual(res, { ok: false, error: 'gone' });
  assert.deepEqual(log0, [0, 1]);
  assert.deepEqual(log.loadReleased, ['L-snap-2']);
});

test('snapshot load: a failed chunk without a message says Unknown', async () => {
  reset();
  putSnap('snap-3', 5, sampleTree());
  fakeDt({ loadSnapshotChunk: async () => ({ ok: false }) });
  assert.deepEqual(await snaps.loadSnapshotChunked('snap-3'), { ok: false, error: 'Unknown' });
});

test('snapshot load: a throwing chunk call gives ok:false and releases', async () => {
  reset();
  putSnap('snap-4', 5, sampleTree());
  const { log } = fakeDt({ loadSnapshotChunk: async () => { throw new Error('ipc down'); } });
  assert.deepEqual(await snaps.loadSnapshotChunked('snap-4'), { ok: false, error: 'ipc down' });
  assert.deepEqual(log.loadReleased, ['L-snap-4']);
});

test('snapshot load: a tree that does not match nodeCount is reported incomplete, still released', async () => {
  reset();
  putSnap('snap-5', 5, sampleTree());
  const { log } = fakeDt({ loadSnapshot: async (id) => ({ ...loadReply(id), nodeCount: 99 }) });
  assert.deepEqual(await snaps.loadSnapshotChunked('snap-5'), { ok: false, error: 'Snapshot is incomplete' });
  assert.deepEqual(log.loadReleased, ['L-snap-5']);
});

test('snapshot load: a snapshot without a tree gives tree null', async () => {
  reset();
  putSnap('snap-6', 5, null);
  const { log } = fakeDt();
  const res = await snaps.loadSnapshotChunked('snap-6');
  assert.deepEqual(res, { ok: true, data: { id: 'snap-6', rootPath: '/r', savedAt: 5, version: '1.0.0', tree: null } });
  assert.deepEqual(log.loadReleased, ['L-snap-6']);
});

async function openCompare(list, over = {}) {
  S.tree = sampleTree(); S.rootPath = '/r';
  for (const k of Object.keys(buttons)) delete buttons[k];
  const rows = [];
  const realCreate = globalThis.document.createElement;
  globalThis.document.createElement = () => { const r = makeRow(); rows.push(r); return r; };
  let made;
  try {
    made = fakeDt({ listSnapshots: async () => ({ ok: true, list }), ...over });
    await snaps.renderSnapshotsPanel();
    await new Promise(r => setImmediate(r));
  } finally { globalThis.document.createElement = realCreate; }
  for (const r of rows) r.kids['.snap-cb'].listeners.change({ target: { checked: true } });
  return { log: made.log, rows, compare: buttons['snap-btn-compare'], card: globalThis.document.getElementById('diff-results-card') };
}
const listOf = (...ids) => ids.map((id) => ({ id, rootPath: '/r', savedAt: 1, totalSize: 1, files: 1, folders: 0 }));

test('compare: loads both snapshots chunked, older is A, diff renders, both released', async () => {
  reset();
  putSnap('snap-new', 20, dir('root', [file('a', 8), file('c', 3)]));
  putSnap('snap-old', 10, dir('root', [file('a', 5), file('b', 5)]));
  const { log, compare, card } = await openCompare(listOf('snap-new', 'snap-old'));
  assert.equal(compare.disabled, false);
  await compare.listeners.click();
  assert.deepEqual(log.loadReleased, ['L-snap-new', 'L-snap-old']);
  // old -> new: b was deleted, c is new, a grew (swapped order would invert all three)
  const rowFor = (p) => card.innerHTML.split('<tr>').find(r => r.includes(`>${p}</td>`));
  assert.ok(rowFor('/r/b').includes('DELETED'));
  assert.ok(rowFor('/r/c').includes('NEW'));
  assert.ok(rowFor('/r/a').includes('GREW'));
});

test('compare: when the second load fails, nothing renders and the first load is released', async () => {
  reset();
  putSnap('snap-x', 20, sampleTree());
  putSnap('snap-y', 10, sampleTree());
  const { log, compare, card } = await openCompare(listOf('snap-x', 'snap-y'), {
    loadSnapshotChunk: async (l, i) => (l === 'L-snap-y' ? { ok: false, error: 'boom' } : { ok: true, ...codec.sliceChunk(snapFlat(l), i, 1) }),
  });
  await compare.listeners.click();
  assert.equal(card.innerHTML, '');
  assert.deepEqual(log.loadReleased, ['L-snap-x', 'L-snap-y']);
});

test('compare: when the first load fails, nothing renders', async () => {
  reset();
  putSnap('snap-p', 20, sampleTree());
  putSnap('snap-q', 10, sampleTree());
  const { compare, card } = await openCompare(listOf('snap-p', 'snap-q'), {
    loadSnapshotChunk: async (l, i) => (l === 'L-snap-p' ? { ok: false, error: 'boom' } : { ok: true, ...codec.sliceChunk(snapFlat(l), i, 1) }),
  });
  await compare.listeners.click();
  assert.equal(card.innerHTML, '');
});

test('compare: the button is disabled while comparing (no second sequence) and re-enabled afterwards', async () => {
  reset();
  putSnap('snap-m', 20, sampleTree());
  putSnap('snap-n', 10, sampleTree());
  let release;
  const gate = new Promise(r => { release = r; });
  let begins = 0;
  const { compare } = await openCompare(listOf('snap-m', 'snap-n'), {
    loadSnapshot: async (id) => { begins++; await gate; return loadReply(id); },
  });
  assert.equal(compare.disabled, false);
  const p = compare.listeners.click();
  assert.equal(compare.disabled, true);
  release();
  await p;
  assert.equal(begins, 2);
  assert.equal(compare.disabled, false);
});

test('compare: the button is re-enabled when a load fails or throws', async () => {
  reset();
  putSnap('snap-u', 20, sampleTree());
  putSnap('snap-v', 10, sampleTree());
  const failing = await openCompare(listOf('snap-u', 'snap-v'), { loadSnapshotChunk: async () => ({ ok: false, error: 'boom' }) });
  await failing.compare.listeners.click();
  assert.equal(failing.compare.disabled, false);
  const throwing = await openCompare(listOf('snap-u', 'snap-v'), { loadSnapshot: async () => { throw new Error('x'); } });
  await throwing.compare.listeners.click();
  assert.equal(throwing.compare.disabled, false);
});

test('compare: the diff is the same whichever snapshot is selected first', async () => {
  reset();
  putSnap('snap-o2', 10, dir('root', [file('a', 5), file('b', 5)]));
  putSnap('snap-n2', 20, dir('root', [file('a', 8), file('c', 3)]));
  const { compare, card } = await openCompare(listOf('snap-o2', 'snap-n2')); // older selected first
  await compare.listeners.click();
  const rowFor = (p) => card.innerHTML.split('<tr>').find(r => r.includes(`>${p}</td>`));
  assert.ok(rowFor('/r/b').includes('DELETED'));
  assert.ok(rowFor('/r/c').includes('NEW'));
});

test('compare: unchecking and rechecking mid-compare does not start a second compare', async () => {
  reset();
  putSnap('snap-c1', 20, sampleTree());
  putSnap('snap-c2', 10, sampleTree());
  let release;
  const gate = new Promise(r => { release = r; });
  let begins = 0;
  const { compare, rows } = await openCompare(listOf('snap-c1', 'snap-c2'), {
    loadSnapshot: async (id) => { begins++; await gate; return loadReply(id); },
  });
  const p = compare.listeners.click();
  const cb = rows[0].kids['.snap-cb'];
  cb.listeners.change({ target: { checked: false } });
  cb.listeners.change({ target: { checked: true } });
  assert.equal(compare.disabled, true); // selection is 2 again but a compare is running
  const p2 = compare.listeners.click(); // a second click is ignored
  assert.equal(begins, 1); // only the running compare's first load
  release();
  await Promise.all([p, p2]);
  assert.equal(begins, 2);
});

test('compare: after a compare the button reflects the selection', async () => {
  reset();
  putSnap('snap-d1', 20, sampleTree());
  putSnap('snap-d2', 10, sampleTree());
  let release;
  const gate = new Promise(r => { release = r; });
  const { compare, rows } = await openCompare(listOf('snap-d1', 'snap-d2'), {
    loadSnapshot: async (id) => { await gate; return loadReply(id); },
  });
  const p = compare.listeners.click();
  rows[0].kids['.snap-cb'].listeners.change({ target: { checked: false } }); // selection is 1 mid-compare
  assert.equal(compare.disabled, true);
  release();
  await p;
  assert.equal(compare.disabled, true); // one selected: still disabled
  rows[0].kids['.snap-cb'].listeners.change({ target: { checked: true } });
  assert.equal(compare.disabled, false);
});
