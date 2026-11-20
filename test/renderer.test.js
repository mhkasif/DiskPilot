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
const makeButton = () => { const b = { disabled: false, listeners: {}, addEventListener(ev, fn) { b.listeners[ev] = fn; }, innerHTML: '' }; return b; };
globalThis.document = { getElementById: (id) => (buttons[id] ??= makeButton()) };

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

function fakeDt(over = {}) {
  const log = { released: [], chunks: [], aborted: [], saved: [], committed: [] };
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
