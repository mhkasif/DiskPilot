'use strict';
// Loads the REAL src/main/ipc/scanner.js and snapshots.js with a stubbed `electron`.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'diskpilot-test-';
const tmpDirs = [];
const mkTmp = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}${name}-`));
  tmpDirs.push(dir);
  return dir;
};
const USER_DATA = mkTmp('userdata');
const handlers = new Map();

const electronStub = {
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  app: { getPath: () => USER_DATA, getVersion: () => '0.0.0-test' },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};
require(path.join(ROOT, 'src/main/ipc/scanner.js'))();
require(path.join(ROOT, 'src/main/ipc/snapshots.js'))();
Module._load = origLoad;

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; this.sent = []; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  isDestroyed() { return this._gone === true; }
}
const call = (name, sender, ...args) => handlers.get(name)({ sender }, ...args);

function makeFixture() {
  const dir = mkTmp('fixture');
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.writeFileSync(path.join(dir, 'f1.txt'), 'x'.repeat(5000));
  fs.writeFileSync(path.join(dir, 'a', 'f2.txt'), 'y'.repeat(9000));
  fs.writeFileSync(path.join(dir, 'a', 'b', 'f3.txt'), 'z');
  return dir;
}

async function pullAll(sender, res) {
  const chunks = [];
  for (let i = 0; i < res.chunkCount; i++) {
    const part = await call('fs:scanChunk', sender, res.scanId, i);
    assert.equal(part.ok, true);
    chunks.push(part);
  }
  return chunks;
}

const { rebuildTree } = require(path.join(ROOT, 'src/main/treeTransfer.js'));
const { CHUNK_SIZE } = require(path.join(ROOT, 'src/main/treeTransfer.js'));
const { existingState } = require(path.join(ROOT, 'src/main/senderState.js'));

function countNodes(n) {
  return 1 + (Array.isArray(n.children) ? n.children.reduce((s, c) => s + countNodes(c), 0) : 0);
}

// ── scan ─────────────────────────────────────────────────────────────────────
test('fs:scan reply has no data and only scalar fields', async () => {
  const dir = makeFixture();
  const A = new Sender(1);
  const res = await call('fs:scan', A, dir, 'sc-1');
  assert.equal(res.ok, true);
  assert.equal('data' in res, false);
  for (const v of Object.values(res)) assert.ok(['string', 'number', 'boolean'].includes(typeof v));
  assert.equal(res.nodeCount, 7);
  await call('fs:releaseScan', A, 'sc-1');
});

test('chunks rebuild to the scanned tree of a real directory', async () => {
  const dir = makeFixture();
  const A = new Sender(2);
  const res = await call('fs:scan', A, dir, 'sc-2');
  const tree = rebuildTree(await pullAll(A, res));
  assert.equal(tree.path, dir);
  assert.equal(countNodes(tree), res.nodeCount);
  const a = tree.children.find(c => c.name === 'a');
  assert.equal(a.children.find(c => c.name === 'f2.txt').isDir, false);
  assert.deepEqual(tree.children.find(c => c.name === 'empty').children, []);
  assert.equal(tree.children.find(c => c.name === 'f1.txt').children, null);
  await call('fs:releaseScan', A, 'sc-2');
});

test('fs:releaseScan frees the entry', async () => {
  const A = new Sender(3);
  const res = await call('fs:scan', A, makeFixture(), 'sc-3');
  assert.equal((await call('fs:scanChunk', A, 'sc-3', 0)).ok, true);
  await call('fs:releaseScan', A, 'sc-3');
  assert.equal((await call('fs:scanChunk', A, 'sc-3', 0)).ok, false);
  assert.ok(res.ok);
});

test('serving the last chunk does not free the entry (release does)', async () => {
  const A = new Sender(4);
  const res = await call('fs:scan', A, makeFixture(), 'sc-4');
  await pullAll(A, res);
  assert.equal((await call('fs:scanChunk', A, 'sc-4', 0)).ok, true);
  await call('fs:releaseScan', A, 'sc-4');
});

test('fs:cancelScan frees the pending entry', async () => {
  const A = new Sender(5);
  await call('fs:scan', A, makeFixture(), 'sc-5');
  await call('fs:cancelScan', A, 'sc-5');
  assert.equal((await call('fs:scanChunk', A, 'sc-5', 0)).ok, false);
});

test('a scan from sender A does not drop sender B pending transfer', async () => {
  const A = new Sender(6), B = new Sender(7);
  await call('fs:scan', B, makeFixture(), 'sc-B');
  await call('fs:scan', A, makeFixture(), 'sc-A');
  assert.equal((await call('fs:scanChunk', B, 'sc-B', 0)).ok, true);
  await call('fs:releaseScan', B, 'sc-B');
  await call('fs:releaseScan', A, 'sc-A');
});

test('a new scan from the same sender drops its older pending transfer', async () => {
  const A = new Sender(8);
  await call('fs:scan', A, makeFixture(), 'sc-old');
  await call('fs:scan', A, makeFixture(), 'sc-new');
  assert.equal((await call('fs:scanChunk', A, 'sc-old', 0)).ok, false);
  assert.equal((await call('fs:scanChunk', A, 'sc-new', 0)).ok, true);
  await call('fs:releaseScan', A, 'sc-new');
});

test('destroyed sender drops its pending transfers', async () => {
  const A = new Sender(9);
  await call('fs:scan', A, makeFixture(), 'sc-d');
  A.emit('destroyed');
  assert.equal((await call('fs:scanChunk', A, 'sc-d', 0)).ok, false);
});

test('scanChunk with a bad index returns ok:false', async () => {
  const A = new Sender(10);
  await call('fs:scan', A, makeFixture(), 'sc-bad');
  assert.equal((await call('fs:scanChunk', A, 'sc-bad', 99)).ok, false);
  await call('fs:releaseScan', A, 'sc-bad');
});

// ── snapshots ────────────────────────────────────────────────────────────────
const f = (name, size) => ({ name, path: `/r/${name}`, isDir: false, size, allocated: size, files: 1, folders: 0, mtime: 1, ext: 'x', error: false, children: null });
const d = (name, children) => ({ name, path: `/r/${name}`, isDir: true, size: 0, allocated: 0, files: 0, folders: 0, mtime: 1, ext: '', error: false, children });
const chunkOf = (nodes, parents) => ({ nodes, parents });

async function upload(sender, rootPath, chunks, nodeCount) {
  const b = await call('snapshot:saveBegin', sender, { rootPath, nodeCount });
  assert.equal(b.ok, true);
  for (const c of chunks) assert.equal((await call('snapshot:saveChunk', sender, b.uploadId, c)).ok, true);
  return call('snapshot:saveCommit', sender, b.uploadId);
}

test('snapshot begin/chunk/commit writes the pruned tree', async () => {
  const S = new Sender(20);
  const nodes = [d('root', []), f('big', 600 * 1024), f('small', 10), d('sub', [])];
  const res = await upload(S, '/r', [chunkOf(nodes.slice(0, 2), [-1, 0]), chunkOf(nodes.slice(2), [0, 0])], 4);
  assert.equal(res.ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'snapshots', `${res.id}.json`), 'utf8'));
  assert.equal(saved.rootPath, '/r');
  assert.deepEqual(saved.tree, {
    name: 'root', path: '/r/root', isDir: true, size: 0, allocated: 0, files: 0, folders: 0, mtime: 1,
    children: [
      { name: 'big', path: '/r/big', isDir: false, size: 600 * 1024, allocated: 600 * 1024, files: 1, folders: 0, mtime: 1 },
      { name: 'sub', path: '/r/sub', isDir: true, size: 0, allocated: 0, files: 0, folders: 0, mtime: 1, children: [] },
    ],
  });
});

test('concurrent uploads A and B both succeed', async () => {
  const A = new Sender(21), B = new Sender(22);
  const a = await call('snapshot:saveBegin', A, { rootPath: '/a', nodeCount: 1 });
  const b = await call('snapshot:saveBegin', B, { rootPath: '/b', nodeCount: 1 });
  assert.equal((await call('snapshot:saveChunk', A, a.uploadId, chunkOf([d('a', [])], [-1]))).ok, true);
  assert.equal((await call('snapshot:saveChunk', B, b.uploadId, chunkOf([d('b', [])], [-1]))).ok, true);
  assert.equal((await call('snapshot:saveCommit', A, a.uploadId)).ok, true);
  assert.equal((await call('snapshot:saveCommit', B, b.uploadId)).ok, true);
});

test('saveAbort frees the upload', async () => {
  const S = new Sender(23);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  await call('snapshot:saveAbort', S, b.uploadId);
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
});

test('destroyed sender drops its uploads', async () => {
  const S = new Sender(24);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  S.emit('destroyed');
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
});

test('saveBegin rejects bad payloads without throwing', async () => {
  const S = new Sender(25);
  for (const bad of [undefined, null, {}, { rootPath: '/r' }, { rootPath: '/r', nodeCount: 0 },
    { rootPath: '/r', nodeCount: 1.5 }, { rootPath: '/r', nodeCount: -3 }, { rootPath: '/r', nodeCount: '3' }]) {
    const r = await call('snapshot:saveBegin', S, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal((await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 })).ok, true);
});

test('over-count chunk and non-integer parents are rejected', async () => {
  const S = new Sender(26);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  const r = await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', []), f('b', 1)], [-1, 0]));
  assert.equal(r.ok, false);
  const b2 = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 2 });
  const r2 = await call('snapshot:saveChunk', S, b2.uploadId, chunkOf([d('a', []), f('b', 1)], [-1, '0']));
  assert.equal(r2.ok, false);
});

test('invalid parents at commit return ok:false instead of throwing', async () => {
  const S = new Sender(27);
  const cases = {
    'second root': [-1, -1],
    'forward parent': [-1, 5],
    'self parent': [-1, 1],
    'negative parent': [-1, -2],
    'parent is a file': [-1, 1],
  };
  for (const [label, parents] of Object.entries(cases)) {
    const nodes = label === 'parent is a file'
      ? [d('r', []), f('x', 1), f('y', 1)] : [d('r', []), f('x', 1)];
    const ps = label === 'parent is a file' ? [-1, 0, 1] : parents;
    const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: nodes.length });
    const c = await call('snapshot:saveChunk', S, b.uploadId, chunkOf(nodes, ps));
    const r = c.ok ? await call('snapshot:saveCommit', S, b.uploadId) : c;
    assert.equal(r.ok, false, label);
  }
  // root with parent != -1 at index 0
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('r', [])], [0]));
  assert.equal((await call('snapshot:saveCommit', S, b.uploadId)).ok, false);
});

test('incomplete upload fails at commit', async () => {
  const S = new Sender(28);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 2 });
  await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('r', [])], [-1]));
  assert.equal((await call('snapshot:saveCommit', S, b.uploadId)).ok, false);
});

test('an upload is not reachable from another window', async () => {
  const A = new Sender(30), B = new Sender(31);
  const b = await call('snapshot:saveBegin', A, { rootPath: '/r', nodeCount: 1 });
  assert.equal((await call('snapshot:saveChunk', B, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
  await call('snapshot:saveAbort', B, b.uploadId); // must not free A's upload
  assert.equal((await call('snapshot:saveChunk', A, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, true);
  assert.equal((await call('snapshot:saveCommit', B, b.uploadId)).ok, false);
  assert.equal((await call('snapshot:saveCommit', A, b.uploadId)).ok, true);
});

// ── round 3 ──────────────────────────────────────────────────────────────────
// Like a real WebContents after destroy: reading `id` throws.
class DyingSender extends Sender {
  constructor(id) { super(id); this._dead = false; }
  get id() { if (this._dead) throw new Error('Object has been destroyed'); return this._id; }
  set id(v) { this._id = v; }
  destroy() { this._dead = true; this.emit('destroyed'); }
}

test('destroyed cleanup does not read sender.id after destroy (scan + upload)', async () => {
  const S = new DyingSender(40);
  await call('fs:scan', S, makeFixture(), 'sc-dying');
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  S._dead = true;
  assert.doesNotThrow(() => S.emit('destroyed'));
  S._dead = false;
  assert.equal((await call('fs:scanChunk', S, 'sc-dying', 0)).ok, false);
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
});

test('cleanup on render-process-gone', async () => {
  const S = new Sender(41);
  await call('fs:scan', S, makeFixture(), 'sc-crash');
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  S.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(existingState({ id: 41 }), undefined);
  assert.equal((await call('fs:scanChunk', S, 'sc-crash', 0)).ok, false);
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
});

test('a destroyed window leaves no state behind', async () => {
  const S = new Sender(51);
  await call('fs:scan', S, makeFixture(), 'sc-gone');
  assert.ok(existingState({ id: 51 }));
  S.emit('destroyed');
  assert.equal(existingState({ id: 51 }), undefined);
});

test('a window gets one state and one pair of listeners, however many calls', async () => {
  const S = new Sender(43);
  for (let i = 0; i < 3; i++) {
    await call('fs:scan', S, makeFixture(), `sc-hook-${i}`);
    const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
    await call('snapshot:saveAbort', S, b.uploadId);
  }
  assert.equal(S.listenerCount('destroyed'), 1);
  assert.equal(S.listenerCount('render-process-gone'), 1);
});

test('destroyed mid-scan: nothing is stored', async () => {
  const S = new Sender(52);
  const p = call('fs:scan', S, makeFixture(), 'sc-mid');
  const st = existingState(S);
  assert.ok(st.scan);
  S.emit('destroyed');
  assert.equal(st.scan, null);
  const r = await p;
  assert.deepEqual(r, { ok: false, cancelled: true });
  assert.equal(existingState({ id: 52 }), undefined);
  assert.equal((await call('fs:scanChunk', S, 'sc-mid', 0)).ok, false);
  assert.equal(existingState({ id: 52 }), undefined);
});

test('crash mid-scan: nothing is stored', async () => {
  const S = new Sender(53);
  const p = call('fs:scan', S, makeFixture(), 'sc-mid2');
  S.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(await p, { ok: false, cancelled: true });
  assert.equal(existingState({ id: 53 }), undefined);
});

test('a scan finishing after its sender reports destroyed is discarded', async () => {
  const S = new Sender(54);
  const p = call('fs:scan', S, makeFixture(), 'sc-late');
  S._gone = true; // destroyed, but no event delivered yet
  const r = await p;
  assert.equal(r.ok, false);
  S._gone = false;
  assert.equal((await call('fs:scanChunk', S, 'sc-late', 0)).ok, false);
});

test('a second scan in the same window cancels the first', async () => {
  const S = new Sender(55);
  const p1 = call('fs:scan', S, makeFixture(), 'sc-one');
  const r2 = await call('fs:scan', S, makeFixture(), 'sc-two');
  const r1 = await p1;
  assert.deepEqual(r1, { ok: false, cancelled: true });
  assert.equal(r2.ok, true);
  assert.equal((await call('fs:scanChunk', S, 'sc-one', 0)).ok, false);
  assert.equal((await call('fs:scanChunk', S, 'sc-two', 0)).ok, true);
  await call('fs:releaseScan', S, 'sc-two');
});

test('the same scanId in two windows does not collide', async () => {
  const A = new Sender(56), B = new Sender(57);
  const [ra, rb] = await Promise.all([
    call('fs:scan', A, makeFixture(), 'same-id'),
    call('fs:scan', B, makeFixture(), 'same-id'),
  ]);
  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  await call('fs:cancelScan', A, 'same-id');
  assert.equal((await call('fs:scanChunk', A, 'same-id', 0)).ok, false);
  assert.equal((await call('fs:scanChunk', B, 'same-id', 0)).ok, true);
});

test('cancelScan from another window does not cancel a running scan', async () => {
  const A = new Sender(58), B = new Sender(59);
  const p = call('fs:scan', A, makeFixture(), 'sc-run');
  await call('fs:cancelScan', B, 'sc-run');
  assert.equal((await p).ok, true);
});

test('cancelScan cancels the caller\'s running scan', async () => {
  const A = new Sender(60);
  const p = call('fs:scan', A, makeFixture(), 'sc-run2');
  await call('fs:cancelScan', A, 'sc-run2');
  assert.deepEqual(await p, { ok: false, cancelled: true });
});

test('a nonexistent path yields an error node, not a failure', async () => {
  const A = new Sender(61);
  const r = await call('fs:scan', A, path.join(os.tmpdir(), 'dp-does-not-exist-xyz'), 'sc-err');
  assert.equal(r.ok, true); // scanNode records an error node instead of throwing
  await call('fs:releaseScan', A, 'sc-err');
});

test('a chunk with an unrelated scanId (not the current one) is refused', async () => {
  const A = new Sender(62);
  await call('fs:scan', A, makeFixture(), 'sc-cur');
  assert.equal((await call('fs:scanChunk', A, 'other', 0)).ok, false);
  await call('fs:releaseScan', A, 'other');
  assert.equal((await call('fs:scanChunk', A, 'sc-cur', 0)).ok, true);
  await call('fs:cancelScan', A, 'other');
  assert.equal((await call('fs:scanChunk', A, 'sc-cur', 0)).ok, true);
});

test('empty chunks are rejected', async () => {
  const S = new Sender(63);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([], []))).ok, false);
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).error, 'Unknown upload');
});

test('scan handlers only act on the owner window', async () => {
  const A = new Sender(44), B = new Sender(45);
  await call('fs:scan', A, makeFixture(), 'sc-own');
  assert.equal((await call('fs:scanChunk', B, 'sc-own', 0)).ok, false);
  await call('fs:releaseScan', B, 'sc-own');
  await call('fs:cancelScan', B, 'sc-own');
  assert.equal((await call('fs:scanChunk', A, 'sc-own', 0)).ok, true);
  await call('fs:releaseScan', A, 'sc-own');
  assert.equal((await call('fs:scanChunk', A, 'sc-own', 0)).ok, false);
});

test('snapshot ids are Date.now based', async () => {
  const S = new Sender(48);
  const realNow = Date.now;
  Date.now = () => 1_000_000_000_000_000;
  try {
    const r = await upload(S, '/r', [chunkOf([d('a', [])], [-1])], 1);
    assert.equal(r.ok, true);
    assert.equal(r.id, 'snap-1000000000000000');
    assert.equal(r.savedAt, 1_000_000_000_000_000);
    assert.ok(fs.existsSync(path.join(USER_DATA, 'snapshots', `${r.id}.json`)));
  } finally {
    Date.now = realNow;
  }
});

test('a chunk larger than CHUNK_SIZE is rejected, one of exactly CHUNK_SIZE is accepted', async () => {
  const S = new Sender(46);
  const N = CHUNK_SIZE;
  const mk = (n) => chunkOf(Array.from({ length: n }, (_, i) => (i === 0 ? d('r', []) : f(`f${i}`, 1))),
    Array.from({ length: n }, (_, i) => (i === 0 ? -1 : 0)));
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: N + 1 });
  const ok = await call('snapshot:saveChunk', S, b.uploadId, mk(N));
  assert.equal(ok.ok, true);
  const b2 = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: N + 1 });
  const big = await call('snapshot:saveChunk', S, b2.uploadId, mk(N + 1));
  assert.deepEqual(big, { ok: false, error: 'Invalid chunk' });
});

test('a committed upload is consumed', async () => {
  const S = new Sender(49);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]));
  assert.equal((await call('snapshot:saveCommit', S, b.uploadId)).ok, true);
  assert.equal((await call('snapshot:saveCommit', S, b.uploadId)).ok, false);
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1]))).ok, false);
});

test('the incomplete-upload failure frees the entry', async () => {
  const S = new Sender(50);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 2 });
  await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('r', [])], [-1]));
  const r = await call('snapshot:saveCommit', S, b.uploadId);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Incomplete upload');
  // entry gone: chunk now says unknown upload (it would be accepted if it were still there)
  const c = await call('snapshot:saveChunk', S, b.uploadId, chunkOf([f('x', 1)], [0]));
  assert.equal(c.ok, false);
  assert.equal(c.error, 'Unknown upload');
});

// ── round 4: redesign pins ───────────────────────────────────────────────────
const progressOf = (S, id) => S.sent.filter(m => m.channel === 'scan:progress' && m.payload.scanId === id);

function deepFixture() {
  const dir = mkTmp('deep');
  for (const n of ['x', 'y', 'z']) fs.mkdirSync(path.join(dir, n, 'sub'), { recursive: true });
  return dir;
}

test('a superseded scan stops walking (no progress after the second scan started)', async () => {
  const S = new Sender(70);
  const p1 = call('fs:scan', S, deepFixture(), 'sc-first');
  await call('fs:scan', S, deepFixture(), 'sc-second');
  await p1;
  assert.equal(progressOf(S, 'sc-first').length, 0);
  assert.ok(progressOf(S, 'sc-second').length > 0);
  await call('fs:releaseScan', S, 'sc-second');
});

test('destroyed mid-scan: the walk stops', async () => {
  const S = new Sender(71);
  const p = call('fs:scan', S, deepFixture(), 'sc-stop');
  S.emit('destroyed');
  await p;
  assert.equal(progressOf(S, 'sc-stop').length, 0);
});

test('a new scan drops the previous result immediately, not only when it finishes', async () => {
  const S = new Sender(72);
  await call('fs:scan', S, makeFixture(), 'sc-prev');
  const p = call('fs:scan', S, deepFixture(), 'sc-next');
  assert.equal((await call('fs:scanChunk', S, 'sc-prev', 0)).ok, false);
  await p;
  await call('fs:releaseScan', S, 'sc-next');
});

test('the scan slot is empty after a scan finishes, fails or is cancelled', async () => {
  const S = new Sender(73);
  await call('fs:scan', S, makeFixture(), 'sc-slot');
  assert.equal(existingState(S).scan, null);
  const p = call('fs:scan', S, makeFixture(), 'sc-slot2');
  await call('fs:cancelScan', S, 'sc-slot2');
  await p;
  assert.equal(existingState(S).scan, null);
  const T = new Sender(74);
  T.isDestroyed = () => { throw new Error('boom'); };
  const r = await call('fs:scan', T, makeFixture(), 'sc-throw');
  assert.deepEqual(r, { ok: false, error: 'boom' });
  assert.equal(existingState(T).scan, null);
});

test('cancelScan of a window without state does nothing', async () => {
  assert.equal(await call('fs:cancelScan', new Sender(75), 'whatever'), undefined);
  assert.equal(existingState({ id: 75 }), undefined);
});

test('dropping a window state empties it (nothing retained through listener closures)', async () => {
  const S = new Sender(76);
  await call('fs:scan', S, makeFixture(), 'sc-ret');
  await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  const st = existingState(S);
  assert.ok(st.transfer);
  assert.equal(st.uploads.size, 1);
  S.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(st.transfer, null);
  assert.equal(st.scan, null);
  assert.equal(st.uploads.size, 0);
  assert.equal(existingState({ id: 76 }), undefined);
});

test('a window that comes back after a crash gets a fresh state', async () => {
  const S = new Sender(77);
  await call('fs:scan', S, makeFixture(), 'sc-a');
  const first = existingState(S);
  S.emit('render-process-gone', {}, { reason: 'crashed' });
  await call('fs:scan', S, makeFixture(), 'sc-b');
  assert.notEqual(existingState(S), first);
  assert.equal((await call('fs:scanChunk', S, 'sc-b', 0)).ok, true);
});

test('crash/scan cycles keep one listener per event', async () => {
  const S = new Sender(80);
  for (let i = 0; i < 12; i++) {
    await call('fs:scan', S, makeFixture(), `sc-cyc-${i}`);
    S.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(existingState(S), undefined);
  }
  await call('fs:scan', S, makeFixture(), 'sc-cyc-last');
  assert.equal(S.listenerCount('destroyed'), 1);
  assert.equal(S.listenerCount('render-process-gone'), 1);
  S.emit('destroyed');
  assert.equal(existingState(S), undefined);
});

test('chunks whose nodes and parents differ in length are rejected', async () => {
  const S = new Sender(78);
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 2 });
  assert.equal((await call('snapshot:saveChunk', S, b.uploadId, chunkOf([d('a', [])], [-1, 0]))).ok, false);
});

test('saveAbort answers ok:true, also for unknown uploads', async () => {
  const S = new Sender(79);
  assert.deepEqual(await call('snapshot:saveAbort', S, 'nope'), { ok: true });
  const b = await call('snapshot:saveBegin', S, { rootPath: '/r', nodeCount: 1 });
  assert.deepEqual(await call('snapshot:saveAbort', S, b.uploadId), { ok: true });
});

test('crash or destroy of a window that has no state is harmless', async () => {
  const S = new Sender(81);
  await call('fs:scan', S, makeFixture(), 'sc-twice');
  S.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.doesNotThrow(() => S.emit('render-process-gone', {}, { reason: 'crashed' }));
  assert.doesNotThrow(() => S.emit('destroyed'));
});

test('cancelScan right after a scan of a single file discards the finished result', async () => {
  const A = new Sender(90);
  const file = path.join(mkTmp('single'), 'one.txt');
  fs.writeFileSync(file, 'x');
  const p = call('fs:scan', A, file, 'sc-single');
  await call('fs:cancelScan', A, 'sc-single');
  assert.deepEqual(await p, { ok: false, cancelled: true });
  assert.equal((await call('fs:scanChunk', A, 'sc-single', 0)).ok, false);
  assert.equal(existingState(A).transfer, null);
});
