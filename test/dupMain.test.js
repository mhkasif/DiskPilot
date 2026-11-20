'use strict';
// Loads the REAL src/main/ipc/duplicates.js with a stubbed `electron` and drives the chunked
// dup:begin / dup:addCandidates / dup:run / dup:resultChunk / dup:release protocol.
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
const handlers = new Map();
const electronStub = {
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  nativeImage: {},
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};
const registerDuplicatesIpc = require(path.join(ROOT, 'src/main/ipc/duplicates.js'));
registerDuplicatesIpc();
Module._load = origLoad;
const { CHUNK_SIZE } = require(path.join(ROOT, 'src/main/treeTransfer.js'));
const { existingState } = require(path.join(ROOT, 'src/main/senderState.js'));

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; this.sent = []; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  isDestroyed() { return this._gone === true; }
}
const call = (name, sender, ...args) => handlers.get(name)({ sender }, ...args);

// Files: two identical (size 5), two identical (size 7), one unique of size 5, one of size 7 that differs.
function makeFiles() {
  const dir = mkTmp('dup');
  const w = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); return p; };
  return {
    a1: w('a1', 'aaaaa'), a2: w('a2', 'aaaaa'), a3: w('a3', 'bbbbb'),
    b1: w('b1', 'ccccccc'), b2: w('b2', 'ccccccc'), b3: w('b3', 'ddddddd'),
  };
}

async function runWith(sender, chunks) {
  const { id } = await call('dup:begin', sender);
  for (const c of chunks) assert.equal((await call('dup:addCandidates', sender, id, c)).ok, true);
  return { id, res: await call('dup:run', sender, id) };
}
async function pull(sender, id, res) {
  const out = [];
  for (let i = 0; i < res.chunkCount; i++) {
    const part = await call('dup:resultChunk', sender, id, i);
    assert.equal(part.ok, true);
    out.push(...part.groups);
  }
  return out;
}
const sortedPaths = (g) => g.files.map(f => path.basename(f.path)).sort();

// ── protocol ─────────────────────────────────────────────────────────────────
test('begin -> addCandidates -> run -> resultChunk finds the duplicate groups', async () => {
  const A = new Sender(1);
  const f = makeFiles();
  const { id, res } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2, f.a3] }, { size: 7, paths: [f.b1, f.b2, f.b3] }]]);
  assert.deepEqual(res, { ok: true, cancelled: false, groupCount: 2, chunkCount: 1 });
  const groups = await pull(A, id, res);
  assert.equal(groups.length, 2);
  const g5 = groups.find(g => g.size === 5), g7 = groups.find(g => g.size === 7);
  assert.deepEqual(sortedPaths(g5), ['a1', 'a2']);
  assert.deepEqual(sortedPaths(g7), ['b1', 'b2']);
  assert.match(g5.hash, /^[0-9a-f]{64}$/);
  for (const file of g5.files) {
    assert.deepEqual(Object.keys(file).sort(), ['birthtime', 'mtime', 'path']);
    assert.ok(file.mtime > 0);
  }
  await call('dup:release', A, id);
});

test('a size group split across chunks is merged by size in main', async () => {
  const A = new Sender(2);
  const f = makeFiles();
  const { id, res } = await runWith(A, [[{ size: 5, paths: [f.a1] }], [{ size: 5, paths: [f.a2, f.a3] }]]);
  assert.equal(res.groupCount, 1);
  const groups = await pull(A, id, res);
  assert.deepEqual(sortedPaths(groups[0]), ['a1', 'a2']);
  await call('dup:release', A, id);
});

test('empty candidate set: run succeeds with no groups and no chunks', async () => {
  const A = new Sender(3);
  const { id, res } = await runWith(A, []);
  assert.deepEqual(res, { ok: true, cancelled: false, groupCount: 0, chunkCount: 0 });
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, false);
});

test('unreadable files are skipped, not an error', async () => {
  const A = new Sender(4);
  const gone = path.join(mkTmp('gone'), 'nope');
  const { res } = await runWith(A, [[{ size: 5, paths: [gone, gone + '2'] }]]);
  assert.deepEqual(res, { ok: true, cancelled: false, groupCount: 0, chunkCount: 0 });
});

test('progress is sent to the calling window only', async () => {
  const A = new Sender(5), B = new Sender(6);
  const f = makeFiles();
  const paths = Array.from({ length: 10 }, () => f.a1);
  await runWith(A, [[{ size: 5, paths }]]);
  assert.deepEqual(A.sent.filter(m => m.channel === 'dup:progress' && !m.payload.text).map(m => m.payload), [{ done: 10, total: 10 }]);
  assert.equal(B.sent.length, 0);
});

// ── chunk validation ─────────────────────────────────────────────────────────
test('a candidate chunk of exactly CHUNK_SIZE paths is accepted, CHUNK_SIZE + 1 is rejected and frees the run', async () => {
  const A = new Sender(10);
  const mk = (n) => [{ size: 1, paths: Array.from({ length: n }, (_, i) => `/p${i}`) }];
  const b1 = await call('dup:begin', A);
  assert.deepEqual(await call('dup:addCandidates', A, b1.id, mk(CHUNK_SIZE)), { ok: true });
  const b2 = await call('dup:begin', A);
  assert.deepEqual(await call('dup:addCandidates', A, b2.id, mk(CHUNK_SIZE + 1)), { ok: false, error: 'Invalid chunk' });
  assert.equal(existingState(A).dup, null);
});

test('the path limit counts the paths of all groups of a chunk together', async () => {
  const A = new Sender(11);
  const half = CHUNK_SIZE / 2;
  const grp = (size, n) => ({ size, paths: Array.from({ length: n }, (_, i) => `/p${size}-${i}`) });
  const b = await call('dup:begin', A);
  assert.equal((await call('dup:addCandidates', A, b.id, [grp(1, half), grp(2, half)])).ok, true);
  const b2 = await call('dup:begin', A);
  assert.equal((await call('dup:addCandidates', A, b2.id, [grp(1, half), grp(2, half + 1)])).ok, false);
});

const invalid = [
  ['not an array', 'x'],
  ['empty array', []],
  ['null group', [null]],
  ['group without size', [{ paths: ['/a'] }]],
  ['non-finite size', [{ size: NaN, paths: ['/a'] }]],
  ['string size', [{ size: '5', paths: ['/a'] }]],
  ['paths not an array', [{ size: 5, paths: '/a' }]],
  ['empty paths', [{ size: 5, paths: [] }]],
  ['non-string path', [{ size: 5, paths: ['/a', 3] }]],
];
for (const [name, chunk] of invalid) {
  test(`invalid chunk (${name}) is rejected and frees the run`, async () => {
    const A = new Sender(12);
    const b = await call('dup:begin', A);
    assert.deepEqual(await call('dup:addCandidates', A, b.id, chunk), { ok: false, error: 'Invalid chunk' });
    assert.equal(existingState(A).dup, null);
    assert.deepEqual(await call('dup:addCandidates', A, b.id, [{ size: 5, paths: ['/a'] }]), { ok: false, error: 'Unknown run' });
  });
}

test('an invalid chunk of a stale id does not free the current run', async () => {
  const A = new Sender(13);
  const old = await call('dup:begin', A);
  const cur = await call('dup:begin', A);
  assert.equal((await call('dup:addCandidates', A, old.id, 'x')).error, 'Unknown run');
  assert.equal((await call('dup:addCandidates', A, cur.id, [{ size: 5, paths: ['/a'] }])).ok, true);
});

// ── ownership / phases ───────────────────────────────────────────────────────
test('a window cannot reach another window run', async () => {
  const A = new Sender(20), B = new Sender(21);
  const f = makeFiles();
  const { id, res } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2] }]]);
  assert.equal((await call('dup:resultChunk', B, id, 0)).ok, false);
  await call('dup:release', B, id);
  await call('dup:cancel', B);
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, true);
  const b = await call('dup:begin', B);
  assert.equal((await call('dup:addCandidates', B, id, [{ size: 5, paths: ['/a'] }])).ok, false);
  assert.equal((await call('dup:run', B, id)).ok, false);
  assert.ok(b.id !== id);
  assert.ok(res.ok);
});

test('ids of a window without state or with a different id are unknown', async () => {
  const A = new Sender(22);
  assert.deepEqual(await call('dup:addCandidates', A, 'x', [{ size: 5, paths: ['/a'] }]), { ok: false, error: 'Unknown run' });
  assert.deepEqual(await call('dup:run', A, 'x'), { ok: false, error: 'Unknown run' });
  assert.deepEqual(await call('dup:resultChunk', A, 'x', 0), { ok: false, error: 'Result is no longer available' });
  assert.equal(await call('dup:release', A, 'x'), undefined);
  assert.equal(await call('dup:cancel', A), undefined);
  assert.equal(existingState(A), undefined);
  await call('dup:begin', A);
  assert.equal((await call('dup:run', A, 'x')).ok, false);
  assert.equal(await call('dup:release', A, 'x'), undefined);
  assert.notEqual(existingState(A).dup, null);
});

test('addCandidates after run and run twice are refused; resultChunk before run is refused', async () => {
  const A = new Sender(23);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: [f.a1, f.a2] }]);
  assert.equal((await call('dup:resultChunk', A, b.id, 0)).ok, false);
  const res = await call('dup:run', A, b.id);
  assert.equal(res.ok, true);
  assert.equal((await call('dup:addCandidates', A, b.id, [{ size: 5, paths: ['/x'] }])).ok, false);
  assert.equal((await call('dup:run', A, b.id)).ok, false);
  assert.equal((await call('dup:resultChunk', A, b.id, 0)).ok, true);
});

test('resultChunk validates the index', async () => {
  const A = new Sender(24);
  const f = makeFiles();
  const { id } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2] }]]);
  for (const i of [-1, 1, 1.5, '0', 'length', undefined, null]) {
    assert.deepEqual(await call('dup:resultChunk', A, id, i), { ok: false, error: 'Invalid chunk index' });
  }
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, true);
});

// ── release / cancel / destroy ───────────────────────────────────────────────
test('release frees the result; serving a chunk does not', async () => {
  const A = new Sender(30);
  const f = makeFiles();
  const { id } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2] }]]);
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, true);
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, true);
  await call('dup:release', A, id);
  assert.equal(existingState(A).dup, null);
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, false);
});

test('a new begin drops the previous run immediately', async () => {
  const A = new Sender(31);
  const f = makeFiles();
  const { id } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2] }]]);
  const next = await call('dup:begin', A);
  assert.notEqual(next.id, id);
  assert.equal((await call('dup:resultChunk', A, id, 0)).ok, false);
});

test('a new begin cancels the run still hashing', async () => {
  const A = new Sender(32);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: Array.from({ length: 200 }, () => f.a1) }]);
  const p = call('dup:run', A, b.id);
  await call('dup:begin', A);
  assert.deepEqual(await p, { ok: false, cancelled: true });
  assert.notEqual(existingState(A).dup, null); // the newer run is untouched by the old run ending
  assert.equal(existingState(A).dup.phase, 'upload');
});

test('cancel stops a running run and frees it', async () => {
  const A = new Sender(33);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: Array.from({ length: 200 }, () => f.a1) }]);
  const p = call('dup:run', A, b.id);
  await call('dup:cancel', A);
  assert.deepEqual(await p, { ok: false, cancelled: true });
  assert.equal(existingState(A).dup, null);
  assert.equal(A.sent.filter(m => m.channel === 'dup:progress').length < 20, true);
});

test('cancel before run makes run return cancelled', async () => {
  const A = new Sender(34);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: [f.a1, f.a2] }]);
  await call('dup:cancel', A);
  assert.deepEqual(await call('dup:run', A, b.id), { ok: false, cancelled: true });
});

test('release while running cancels the run', async () => {
  const A = new Sender(35);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: Array.from({ length: 200 }, () => f.a1) }]);
  const p = call('dup:run', A, b.id);
  await call('dup:release', A, b.id);
  assert.equal((await p).cancelled, true);
});

test('destroy or crash of the window drops its run and cancels a running one', async () => {
  const A = new Sender(36);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: Array.from({ length: 200 }, () => f.a1) }]);
  const st = existingState(A);
  const p = call('dup:run', A, b.id);
  A.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(st.dup, null);
  assert.equal((await p).cancelled, true);
  assert.equal(existingState(A), undefined);
  const B = new Sender(37);
  const { id } = await runWith(B, [[{ size: 5, paths: [f.a1, f.a2] }]]);
  const stB = existingState(B);
  B.emit('destroyed');
  assert.equal(stB.dup, null);
  assert.equal((await call('dup:resultChunk', B, id, 0)).ok, false);
});

// ── result chunking ──────────────────────────────────────────────────────────
test('a result with more than CHUNK_SIZE files is served in bounded chunks and merges back', async () => {
  const A = new Sender(40);
  const f = makeFiles();
  const { id, res } = await runWith(A, [[{ size: 5, paths: Array.from({ length: CHUNK_SIZE }, () => f.a1) }], [{ size: 5, paths: Array.from({ length: 5 }, () => f.a1) }]]);
  assert.equal(res.groupCount, 1);
  assert.equal(res.chunkCount, 2);
  const c0 = await call('dup:resultChunk', A, id, 0), c1 = await call('dup:resultChunk', A, id, 1);
  assert.equal(c0.groups[0].files.length, CHUNK_SIZE);
  assert.equal(c1.groups[0].files.length, 5);
  assert.equal(c0.groups[0].hash, c1.groups[0].hash);
  await call('dup:release', A, id);
});

// ── pins ─────────────────────────────────────────────────────────────────────
test('begin answers ok with an id; ids differ per run', async () => {
  const A = new Sender(50);
  const r1 = await call('dup:begin', A), r2 = await call('dup:begin', A);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(typeof r1.id, 'string');
  assert.notEqual(r1.id, r2.id);
});

test('addCandidates refuses the whole chunk when one group of it is invalid', async () => {
  const A = new Sender(51);
  const b = await call('dup:begin', A);
  const r = await call('dup:addCandidates', A, b.id, [{ size: 5, paths: ['/a'] }, { size: 6, paths: [] }]);
  assert.deepEqual(r, { ok: false, error: 'Invalid chunk' });
});

test('while a run is hashing, it accepts no more candidates and no second run; its candidate map is released', async () => {
  const A = new Sender(52);
  const f = makeFiles();
  const b = await call('dup:begin', A);
  await call('dup:addCandidates', A, b.id, [{ size: 5, paths: Array.from({ length: 200 }, () => f.a1) }]);
  const p = call('dup:run', A, b.id);
  const dup = existingState(A).dup;
  assert.equal(dup.phase, 'running');
  assert.equal(dup.sizes, null);
  assert.deepEqual(await call('dup:addCandidates', A, b.id, [{ size: 5, paths: [f.a2] }]), { ok: false, error: 'Unknown run' });
  assert.deepEqual(await call('dup:run', A, b.id), { ok: false, error: 'Unknown run' });
  assert.equal((await p).ok, true);
  assert.equal(existingState(A).dup.phase, 'done');
});

test('result pieces carry the index of their result group', async () => {
  const A = new Sender(53);
  const f = makeFiles();
  const { id, res } = await runWith(A, [[{ size: 5, paths: [f.a1, f.a2] }, { size: 7, paths: [f.b1, f.b2] }]]);
  const out = (await pull(A, id, res)).sort((x, y) => x.gi - y.gi);
  assert.deepEqual(out.map(g => g.gi), [0, 1]);
  assert.deepEqual(out.map(g => g.size).sort(), [5, 7]);
});

test('two size groups with identical content stay two result groups, like the old dup:find', async () => {
  const A = new Sender(54);
  const dir = mkTmp('collide');
  const w = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); return p; };
  // a file changed size between scan and hash: x1/x2 are filed under size 3 and size 9 but hold the same bytes
  const x1 = w('x1', 'same'), x2 = w('x2', 'same'), y1 = w('y1', 'same'), y2 = w('y2', 'same');
  const { id, res } = await runWith(A, [[{ size: 3, paths: [x1, x2] }, { size: 9, paths: [y1, y2] }]]);
  assert.equal(res.groupCount, 2);
  const out = await pull(A, id, res);
  assert.equal(out.length, 2);
  assert.equal(out[0].hash, out[1].hash);
  assert.deepEqual(out.map(g => g.size), [3, 9]);
  assert.deepEqual(out.map(g => g.gi), [0, 1]);
  assert.deepEqual(out.map(g => g.files.length), [2, 2]);
});

test('a run cancelled while hashing sends no progress for the file that finished after the cancel', async () => {
  const A = new Sender(55);
  const f = makeFiles();
  const realCreate = fs.createReadStream;
  let streams = 0;
  fs.createReadStream = (...args) => {
    const stream = realCreate.apply(fs, args);
    if (++streams === 10) stream.once('end', () => handlers.get('dup:cancel')({ sender: A }));
    return stream;
  };
  try {
    const { id } = await call('dup:begin', A);
    await call('dup:addCandidates', A, id, [{ size: 5, paths: Array.from({ length: 30 }, () => f.a1) }]);
    assert.equal((await call('dup:run', A, id)).cancelled, true);
  } finally {
    fs.createReadStream = realCreate;
  }
  assert.equal(A.sent.filter(m => m.channel === 'dup:progress').length, 0);
});
