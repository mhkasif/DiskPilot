'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const v8     = require('node:v8');
const { pathToFileURL } = require('node:url');

const MAIN_PATH     = path.join(__dirname, '..', 'src', 'main', 'treeTransfer.js');
const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer', 'js', 'treeTransfer.js');

require('./registerEsmHooks.js'); // renderer files are ES modules without "type": "module"
const main = require(MAIN_PATH);
let renderer;

test.before(async () => {
  renderer = await import(pathToFileURL(RENDERER_PATH).href);
});

// ── helpers ──────────────────────────────────────────────────────────────────
function file(name, size, extra = {}) {
  return {
    name, path: `/r/${name}`, isDir: false, size, allocated: size, files: 1, folders: 0,
    mtime: 1, ext: 'bin', error: false, children: null, ...extra,
  };
}

function dir(name, children, extra = {}) {
  return {
    name, path: `/r/${name}`, isDir: true, size: 0, allocated: 0, files: 0, folders: 0,
    mtime: 1, ext: '', error: false, children, ...extra,
  };
}

// Wide + deep tree with exactly `total` nodes (root included).
function bigTree(total) {
  const root = dir('root', []);
  let count = 1;
  let cur = root;
  let sub = null;
  while (count < total) {
    if (count % 50 === 1) {
      sub = dir(`d${count}`, []);
      cur.children.push(sub);
      cur = sub;
    } else {
      cur.children.push(file(`f${count}`, count));
    }
    count++;
  }
  return root;
}

function viaChunks(codecOut, codecIn, tree, chunkSize) {
  const flat = codecOut.flattenTree(tree);
  const n = codecOut.chunkCount(flat.nodes.length, chunkSize);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    // structuredClone mimics the IPC copy: the receiver must not share objects
    chunks.push(structuredClone(codecOut.sliceChunk(flat, i, chunkSize)));
  }
  return codecIn.rebuildTree(chunks);
}

const samples = {
  'single file root': () => file('only', 5),
  'empty dir': () => dir('empty', []),
  'nested with null children': () =>
    dir('root', [dir('a', [file('x', 3), file('y', 2)]), dir('b', []), file('z', 1)]),
  'error nodes': () =>
    dir('root', [file('bad', 0, { error: true }), dir('unreadable', null, { error: true })]),
  'extra keys': () =>
    dir('root', [
      file('link', 4, { isSymlink: true, atime: 9, birthtime: 8 }),
      file('dup', 0, { isDuplicate: true, atime: 7 }),
    ], { atime: 5 }),
};

// ── round trips, both directions, several chunk sizes ────────────────────────
for (const [label, make] of Object.entries(samples)) {
  for (const chunkSize of [1, 2, 3, 20000]) {
    test(`round trip main -> renderer: ${label} (chunk ${chunkSize})`, () => {
      assert.deepEqual(viaChunks(main, renderer, make(), chunkSize), make());
    });
    test(`round trip renderer -> main: ${label} (chunk ${chunkSize})`, () => {
      assert.deepEqual(viaChunks(renderer, main, make(), chunkSize), make());
    });
  }
}

test('error dir with children null stays null, not []', () => {
  const out = viaChunks(main, renderer, samples['error nodes'](), 2);
  assert.equal(out.children[1].children, null);
  assert.equal(out.children[0].children, null);
});

test('empty dir keeps an empty array', () => {
  const out = viaChunks(main, renderer, samples['empty dir'](), 1);
  assert.deepEqual(out.children, []);
});

test('rebuild does not alias the original tree', () => {
  const tree = samples['nested with null children']();
  const out  = viaChunks(main, renderer, tree, 2);
  assert.notEqual(out, tree);
  assert.notEqual(out.children[0], tree.children[0]);
});

test('flatten does not mutate the original tree', () => {
  const tree = samples['nested with null children']();
  const copy = samples['nested with null children']();
  const flat = main.flattenTree(tree);
  main.sliceChunk(flat, 0, 2);
  assert.deepEqual(tree, copy);
});

// ── chunking ─────────────────────────────────────────────────────────────────
for (const codecName of ['main', 'renderer']) {
  test(`chunks cover every node exactly once (${codecName})`, () => {
    const codec = codecName === 'main' ? main : renderer;
    const tree  = bigTree(1003);
    const flat  = codec.flattenTree(tree);
    assert.equal(flat.nodes.length, 1003);
    const c = 100;
    const n = codec.chunkCount(flat.nodes.length, c);
    assert.equal(n, Math.ceil(1003 / c));
    const seen = [];
    for (let i = 0; i < n; i++) {
      const chunk = codec.sliceChunk(flat, i, c);
      assert.equal(chunk.nodes.length, chunk.parents.length);
      assert.ok(chunk.nodes.length <= c);
      seen.push(...chunk.nodes.map(r => r.name));
    }
    assert.equal(seen.length, 1003);
    assert.deepEqual(seen, flat.nodes.map(r => r.name));
    assert.equal(new Set(seen).size, 1003);
  });
}

test('sliceChunk returns null out of range or for bad index', () => {
  const flat = main.flattenTree(samples['nested with null children']());
  assert.equal(main.sliceChunk(flat, -1, 2), null);
  assert.equal(main.sliceChunk(flat, 3, 2), null);
  assert.equal(main.sliceChunk(flat, 1.5, 2), null);
  assert.equal(main.sliceChunk(flat, '0', 2), null);
  assert.notEqual(main.sliceChunk(flat, 2, 2), null);
});

test('chunkCount of empty tree is 0 and default size is CHUNK_SIZE', () => {
  assert.equal(main.chunkCount(0), 0);
  assert.equal(main.CHUNK_SIZE, 20000);
  assert.equal(renderer.CHUNK_SIZE, 20000);
  assert.equal(main.chunkCount(20000), 1);
  assert.equal(main.chunkCount(20001), 2);
});

test('parents: pre-order, parent index lower than child, root is -1', () => {
  const flat = main.flattenTree(samples['nested with null children']());
  assert.deepEqual(flat.nodes.map(n => n.name), ['root', 'a', 'x', 'y', 'b', 'z']);
  assert.deepEqual(flat.parents, [-1, 0, 1, 1, 0, 0]);
  flat.parents.forEach((p, i) => { if (i > 0) assert.ok(p < i); });
});

test('child order is preserved', () => {
  const kids = ['k5', 'k1', 'k4', 'k2', 'k3'].map((n, i) => file(n, 100 - i));
  const tree = dir('root', kids);
  const out  = viaChunks(main, renderer, tree, 2);
  assert.deepEqual(out.children.map(c => c.name), ['k5', 'k1', 'k4', 'k2', 'k3']);
});

test('deep tree (100 000 levels) does not overflow the stack', () => {
  let node = file('leaf', 1);
  for (let i = 0; i < 100000; i++) node = dir(`d${i}`, [node]);
  const flat = main.flattenTree(node);
  assert.equal(flat.nodes.length, 100001);
  const out = viaChunks(main, renderer, node, 20000);
  assert.equal(out.name, 'd99999');
});

// ── size guard ───────────────────────────────────────────────────────────────
test('every chunk of a 200 000-node tree serializes far below the 2 GB limit', () => {
  const tree = bigTree(200000);
  const flat = main.flattenTree(tree);
  const n = main.chunkCount(flat.nodes.length);
  assert.equal(n, 10);
  const BOUND = 64 * 1024 * 1024;
  for (let i = 0; i < n; i++) {
    const len = v8.serialize(main.sliceChunk(flat, i)).length;
    assert.ok(len < BOUND, `chunk ${i} is ${len} bytes`);
  }
  const out = viaChunks(main, renderer, tree, main.CHUNK_SIZE);
  assert.equal(flatCount(out), 200000);
});

function flatCount(root) {
  let c = 0;
  const st = [root];
  while (st.length) {
    const n = st.pop();
    c++;
    if (Array.isArray(n.children)) st.push(...n.children);
  }
  return c;
}

// ── both copies are the same code ────────────────────────────────────────────
test('main and renderer copies have identical logic', () => {
  const norm = (p) => fs.readFileSync(p, 'utf8')
    .replace(/^'use strict';\n/m, '')
    .replace(/^module\.exports = .*\n/m, '')
    .replace(/^export (?=function|const)/gm, '')
    .split('\n')
    .filter(l => !l.startsWith('//'))
    .join('\n');
  assert.equal(norm(RENDERER_PATH), norm(MAIN_PATH));
});
