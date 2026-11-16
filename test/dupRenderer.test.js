'use strict';
// Runs the real src/renderer/js/duplicates.js against fake DOM-dependent modules (test/stubs)
// and a fake window.dt, to pin the renderer side of the chunked duplicate search.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT  = path.join(__dirname, '..');
const JS    = pathToFileURL(path.join(ROOT, 'src/renderer/js') + '/').href;
const STUBS = pathToFileURL(path.join(__dirname, 'stubs') + '/').href;

require('./registerEsmHooks.js');

let dups, S, el;
const nodes = {};
const makeNode = () => { const n = { listeners: {}, innerHTML: '', style: {}, addEventListener(ev, fn) { n.listeners[ev] = fn; } }; return n; };
globalThis.document = { getElementById: (id) => (nodes[id] ??= makeNode()) };

test.before(async () => {
  dups = await import(JS + 'duplicates.js');
  S = (await import(STUBS + 'state.js')).S;
  el = (await import(STUBS + 'elements.js')).el;
});

const CS = 20000;
// Wait for an observable condition (bounded poll), never for a fixed number of ticks: the panel
// leaves through a dynamic import('./scan.js') whose first resolution takes longer on some Node versions.
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not reached: ' + cond);
    await new Promise(r => setTimeout(r, 2));
  }
}
// For "nothing more happens" checks: let already queued work run, then look.
const settle = () => new Promise(r => setTimeout(r, 20));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const dgroup = (hash, n, size = 5, gi = 0) => ({ hash, size, gi, files: Array.from({ length: n }, (_, i) => ({ path: `/${hash}${i}`, mtime: 1, birthtime: 1 })) });

// fake main process: stores what is uploaded, serves `result` in chunks of `serve` groups
function fakeDt(over = {}) {
  const log = { uploads: [], released: [], calls: [], cancelled: 0, progressOn: 0, progressOff: 0 };
  const result = over.result || [dgroup('h1', 2), dgroup('h2', 3)];
  const serve = over.serve || 1;
  const chunks = [];
  for (let i = 0; i < result.length; i += serve) chunks.push(result.slice(i, i + serve));
  const dt = {
    beginDuplicates: async () => { log.calls.push('begin'); return { ok: true, id: 'D1' }; },
    addDuplicateCandidates: async (id, c) => { log.calls.push('add'); log.uploads.push(c); return { ok: true }; },
    runDuplicates: async (id) => { log.calls.push('run'); return { ok: true, cancelled: false, groupCount: result.length, chunkCount: chunks.length }; },
    duplicateResultChunk: async (id, i) => { log.calls.push(`chunk${i}`); return { ok: true, groups: chunks[i] }; },
    releaseDuplicates: (id) => { log.released.push(id); },
    cancelDuplicates: () => { log.cancelled++; },
    trackEvent() {},
    onDupProgress: () => { log.progressOn++; },
    offDupProgress: () => { log.progressOff++; },
    ...over.dt,
  };
  globalThis.window = { dt };
  return { dt, log };
}
const never = () => null;
const plain = ({ gi, ...g }) => g; // the result groups without the piece index

// ── searchDuplicates ─────────────────────────────────────────────────────────
test('search: uploads chunks, runs, pulls result chunks in order, merges groups split over chunks, releases once', async () => {
  const { log } = fakeDt({ serve: 1, result: [dgroup('h1', 2, 5, 0), dgroup('h2', 3, 5, 1)] });
  const cand = [{ size: 5, paths: Array.from({ length: CS + 1 }, (_, i) => `/p${i}`) }];
  const out = await dups.searchDuplicates(cand, never);
  assert.deepEqual(log.calls, ['begin', 'add', 'add', 'run', 'chunk0', 'chunk1']);
  assert.deepEqual(log.uploads.map(c => c[0].paths.length), [CS, 1]);
  assert.deepEqual(out, { groups: [plain(dgroup('h1', 2)), plain(dgroup('h2', 3))] });
  assert.deepEqual(log.released, ['D1']);
});

test('search: one group split across result chunks is merged by its index, in order', async () => {
  const split = [dgroup('h1', 2), { ...dgroup('h1', 2), files: [{ path: '/x', mtime: 2, birthtime: 2 }] }, dgroup('h2', 2, 5, 1)];
  const { log } = fakeDt({ serve: 1, result: split, dt: {} });
  // groupCount of the fake is the piece count; override to the real group count
  window.dt.runDuplicates = async () => ({ ok: true, cancelled: false, groupCount: 2, chunkCount: 3 });
  const out = await dups.searchDuplicates([{ size: 5, paths: ['/a', '/b'] }], never);
  assert.equal(out.groups.length, 2);
  assert.deepEqual(out.groups[0].files.map(f => f.path), ['/h10', '/h11', '/x']);
  assert.equal(out.groups[0].hash, 'h1');
  assert.equal(out.groups[0].size, 5);
  assert.deepEqual(out.groups[1], plain(dgroup('h2', 2)));
  assert.equal('gi' in out.groups[0], false);
  assert.deepEqual(log.released, ['D1']);
});

test('search: merging does not mutate the pieces received', async () => {
  const piece = dgroup('h1', 1);
  fakeDt({ serve: 1, result: [piece, dgroup('h1', 1)] });
  window.dt.runDuplicates = async () => ({ ok: true, cancelled: false, groupCount: 1, chunkCount: 2 });
  await dups.searchDuplicates([{ size: 5, paths: ['/a', '/b'] }], never);
  assert.equal(piece.files.length, 1);
});

test('search: groups with the same hash but different index stay separate groups, in order, with their own size', async () => {
  const pieces = [dgroup('same', 2, 3, 0), dgroup('same', 2, 9, 1)];
  fakeDt({ serve: 1, result: pieces });
  window.dt.runDuplicates = async () => ({ ok: true, cancelled: false, groupCount: 2, chunkCount: 2 });
  const out = await dups.searchDuplicates([{ size: 3, paths: ['/a', '/b'] }], never);
  assert.deepEqual(out, { groups: [plain(pieces[0]), plain(pieces[1])] });
});

test('search: no candidates still runs and returns no groups', async () => {
  const { log } = fakeDt({ result: [] });
  const out = await dups.searchDuplicates([], never);
  assert.deepEqual(out, { groups: [] });
  assert.deepEqual(log.calls, ['begin', 'run']);
  assert.deepEqual(log.released, ['D1']);
});

test('search: a failed begin is an error and releases nothing', async () => {
  const { log } = fakeDt({ dt: { beginDuplicates: async () => ({ ok: false, error: 'nope' }) } });
  assert.deepEqual(await dups.searchDuplicates([{ size: 1, paths: ['a'] }], never), { error: 'nope' });
  assert.deepEqual(log.released, []);
  fakeDt({ dt: { beginDuplicates: async () => ({ ok: false }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'Unknown error' });
});

test('search: a throwing begin is an error and releases nothing', async () => {
  const { log } = fakeDt({ dt: { beginDuplicates: async () => { throw new Error('boom'); } } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'boom' });
  assert.deepEqual(log.released, []);
});

test('search: a failed upload chunk is an error, run is not called, run released', async () => {
  const { log } = fakeDt({ dt: { addDuplicateCandidates: async () => ({ ok: false, error: 'bad' }) } });
  assert.deepEqual(await dups.searchDuplicates([{ size: 1, paths: ['a'] }], never), { error: 'bad' });
  assert.equal(log.calls.includes('run'), false);
  assert.deepEqual(log.released, ['D1']);
  fakeDt({ dt: { addDuplicateCandidates: async () => ({ ok: false }) } });
  assert.deepEqual(await dups.searchDuplicates([{ size: 1, paths: ['a'] }], never), { error: 'Unknown error' });
});

test('search: a failed run is an error and releases', async () => {
  const { log } = fakeDt({ dt: { runDuplicates: async () => ({ ok: false, error: 'bad run' }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'bad run' });
  assert.deepEqual(log.released, ['D1']);
  fakeDt({ dt: { runDuplicates: async () => ({ ok: false }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'Unknown error' });
});

test('search: a cancelled run reply is reported as cancelled', async () => {
  const { log } = fakeDt({ dt: { runDuplicates: async () => ({ ok: false, cancelled: true }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { cancelled: true });
  assert.deepEqual(log.released, ['D1']);
});

test('search: a failed or throwing result chunk is an error and releases', async () => {
  const { log } = fakeDt({ dt: { duplicateResultChunk: async () => ({ ok: false, error: 'gone' }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'gone' });
  assert.deepEqual(log.released, ['D1']);
  fakeDt({ dt: { duplicateResultChunk: async () => ({ ok: false }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'Unknown error' });
  const t = fakeDt({ dt: { duplicateResultChunk: async () => { throw new Error('boom'); } } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'boom' });
  assert.deepEqual(t.log.released, ['D1']);
});

test('search: a group count that does not match is an incomplete result', async () => {
  const { log } = fakeDt({ result: [dgroup('h1', 2)], dt: { runDuplicates: async () => ({ ok: true, cancelled: false, groupCount: 2, chunkCount: 1 }) } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'Duplicate result is incomplete' });
  assert.deepEqual(log.released, ['D1']);
});

test('search: stop signal after begin, after an upload chunk, after run and after a result chunk ends the search and releases', async () => {
  for (const stopAfter of [1, 2, 3, 4]) {
    const { log } = fakeDt({ serve: 1 });
    let n = 0;
    const out = await dups.searchDuplicates([{ size: 5, paths: ['/a', '/b'] }], () => (++n >= stopAfter ? { cancelled: true } : null));
    assert.deepEqual(out, { cancelled: true }, `stopAfter ${stopAfter}`);
    assert.deepEqual(log.released, ['D1']);
    assert.equal(log.calls.length, stopAfter, `stopAfter ${stopAfter}`); // begin, add, run, chunk0
  }
});

test('search: the stop signal after the last result chunk wins over the result', async () => {
  fakeDt({ serve: 1 });
  let calls = 0;
  window.dt.duplicateResultChunk = async (id, i) => { calls++; return { ok: true, groups: [dgroup(`h${i}`, 2)] }; };
  window.dt.runDuplicates = async () => ({ ok: true, cancelled: false, groupCount: 2, chunkCount: 2 });
  let stop = null;
  const out = await dups.searchDuplicates([], () => { if (calls === 2) stop = { superseded: true }; return stop; });
  assert.deepEqual(out, { superseded: true });
});

test('search: a stale search stops pulling chunks', async () => {
  const { log } = fakeDt({ serve: 1 });
  let stale = false;
  window.dt.duplicateResultChunk = async (id, i) => { log.calls.push(`chunk${i}`); stale = true; return { ok: true, groups: [dgroup('h1', 2)] }; };
  window.dt.runDuplicates = async () => ({ ok: true, cancelled: false, groupCount: 1, chunkCount: 5 });
  const out = await dups.searchDuplicates([], () => (stale ? { superseded: true } : null));
  assert.deepEqual(out, { superseded: true });
  assert.deepEqual(log.calls.filter(c => c.startsWith('chunk')), ['chunk0']);
});

// ── panel ────────────────────────────────────────────────────────────────────
function treeWith(sizes) {
  return { name: 'r', path: '/r', isDir: true, size: 1, children: sizes.map((s, i) => ({ name: `f${i}`, path: `/r/f${i}`, isDir: false, size: s, children: null })) };
}
const body = () => nodes['dup-body'].innerHTML;
function resetPanel() {
  for (const k of Object.keys(nodes)) delete nodes[k];
  S.tree = treeWith([5, 5, 7, 9, 7, 0, 0]);
  el.treeWrap.style.display = 'none';
}

test('panel: only size groups with 2+ files are uploaded, empty result shows the no-duplicates card', async () => {
  resetPanel();
  const { log } = fakeDt({ result: [] });
  await dups.renderDuplicatesPanel();
  assert.deepEqual(log.uploads, [[{ size: 5, paths: ['/r/f0', '/r/f1'], gi: 0 }, { size: 7, paths: ['/r/f2', '/r/f4'], gi: 1 }]]);
  assert.match(body(), /No duplicate files found/);
  assert.equal(log.progressOn, 1);
  assert.equal(log.progressOff, 1);
  assert.deepEqual(log.released, ['D1']);
});

test('panel: no tree shows the scan-first message and does not talk to main', async () => {
  resetPanel();
  S.tree = null;
  const { log } = fakeDt();
  await dups.renderDuplicatesPanel();
  assert.deepEqual(log.calls, []);
  assert.match(el.featurePanel.innerHTML, /scan a directory first/);
});

test('panel: an error shows the message', async () => {
  resetPanel();
  fakeDt({ dt: { runDuplicates: async () => ({ ok: false, error: 'kaput' }) } });
  await dups.renderDuplicatesPanel();
  assert.match(body(), /error scanning: kaput/);
  assert.equal(el.treeWrap.style.display, 'none');
});

test('panel: a thrown error shows the message', async () => {
  resetPanel();
  fakeDt({ dt: { beginDuplicates: async () => { throw new Error('boom'); } } });
  await dups.renderDuplicatesPanel();
  assert.match(body(), /error scanning: boom/);
});

test('panel: cancel while the run is hashing returns to the tree', async () => {
  resetPanel();
  const gate = deferred();
  const { log } = fakeDt({ dt: { runDuplicates: () => { log.calls.push('run'); return gate.promise; } } });
  const p = dups.renderDuplicatesPanel();
  await until(() => log.calls.includes('run'));
  nodes['dup-btn-cancel'].listeners.click();
  assert.equal(log.cancelled, 1);
  gate.resolve({ ok: false, cancelled: true });
  await p;
  await until(() => el.treeWrap.style.display === 'flex');
  assert.deepEqual(log.released, ['D1']);
  assert.equal(log.progressOff, 1);
});

test('panel: cancel while uploading stops the upload and never runs', async () => {
  resetPanel();
  S.tree = treeWith(Array.from({ length: CS + 2 }, () => 5));
  const gate = deferred();
  let adds = 0;
  const { log } = fakeDt({ dt: { addDuplicateCandidates: async () => { adds++; await gate.promise; return { ok: true }; } } });
  const p = dups.renderDuplicatesPanel();
  await until(() => adds === 1);
  nodes['dup-btn-cancel'].listeners.click();
  gate.resolve();
  await p;
  await until(() => el.treeWrap.style.display === 'flex');
  assert.equal(adds, 1);
  assert.equal(log.calls.includes('run'), false);
  assert.deepEqual(log.released, ['D1']);
});

test('panel: a stale reply of an older run is ignored; the newer run keeps its listener and result', async () => {
  resetPanel();
  const gate = deferred();
  let runs = 0;
  const { log } = fakeDt({
    result: [],
    dt: { runDuplicates: (id) => (++runs === 1 ? gate.promise : Promise.resolve({ ok: true, cancelled: false, groupCount: 0, chunkCount: 0 })) },
  });
  const first = dups.renderDuplicatesPanel();
  await until(() => runs === 1);
  await dups.renderDuplicatesPanel(); // newer run finishes first
  assert.match(body(), /No duplicate files found/);
  assert.equal(log.progressOff, 1);
  nodes['dup-body'].innerHTML = 'NEWER';
  el.treeWrap.style.display = 'none';
  gate.resolve({ ok: false, error: 'old failure' });
  await first;
  await settle();
  assert.equal(body(), 'NEWER');           // the stale reply did not render
  assert.equal(el.treeWrap.style.display, 'none');
  assert.equal(log.progressOff, 1);         // and did not remove the newer run's listener
  assert.deepEqual(log.released, ['D1', 'D1']);
});

test('panel: a stale cancelled reply of an older run does not send the user to the tree', async () => {
  resetPanel();
  const gate = deferred();
  let runs = 0;
  fakeDt({ result: [], dt: { runDuplicates: () => (++runs === 1 ? gate.promise : Promise.resolve({ ok: true, cancelled: false, groupCount: 0, chunkCount: 0 })) } });
  const first = dups.renderDuplicatesPanel();
  await until(() => runs === 1);
  await dups.renderDuplicatesPanel();
  el.treeWrap.style.display = 'none';
  gate.resolve({ ok: false, cancelled: true });
  await first;
  await settle();
  assert.equal(el.treeWrap.style.display, 'none');
});

test('search: a thrown error without a message is reported as Unknown error', async () => {
  fakeDt({ dt: { beginDuplicates: async () => { throw new Error(); } } });
  assert.deepEqual(await dups.searchDuplicates([], never), { error: 'Unknown error' });
});

test('search: a begin that fails or throws after the search was stopped reports the stop, not an error', async () => {
  for (const dt of [{ beginDuplicates: async () => ({ ok: false, error: 'nope' }) }, { beginDuplicates: async () => { throw new Error('boom'); } }]) {
    fakeDt({ dt });
    assert.deepEqual(await dups.searchDuplicates([], () => ({ superseded: true })), { superseded: true });
  }
});

test('search: a call that throws after the search was stopped reports the stop, not the error', async () => {
  fakeDt({ dt: { runDuplicates: async () => { throw new Error('late'); } } });
  let n = 0;
  const out = await dups.searchDuplicates([], () => (++n > 1 ? { cancelled: true } : null)); // 1st check ok, run throws, 2nd check stops
  assert.deepEqual(out, { cancelled: true });
});

test('search: a begin that succeeded but was stopped meanwhile is still released', async () => {
  const { log } = fakeDt();
  assert.deepEqual(await dups.searchDuplicates([], () => ({ cancelled: true })), { cancelled: true });
  assert.deepEqual(log.released, ['D1']);
});

test('panel: a begin that fails after a newer run took over does not touch the newer run', async () => {
  resetPanel();
  const gate = deferred();
  let begins = 0;
  const { log } = fakeDt({ result: [], dt: { beginDuplicates: () => (++begins === 1 ? gate.promise : Promise.resolve({ ok: true, id: 'D1' })) } });
  const first = dups.renderDuplicatesPanel();
  await until(() => begins === 1);
  await dups.renderDuplicatesPanel();
  nodes['dup-body'].innerHTML = 'NEWER';
  gate.resolve({ ok: false, error: 'old failure' });
  await first;
  await settle();
  assert.equal(body(), 'NEWER');
  assert.equal(log.progressOff, 1);
});
