'use strict';
// Pure codec for moving a scan tree over IPC in bounded chunks.
// KEEP IN SYNC with src/renderer/js/treeTransfer.js (identical logic, ESM exports);
// test/treeTransfer.test.js asserts both copies behave the same.
//
// Flat format (pre-order DFS, a parent always has a lower index than its children):
//   { nodes: Array<record>, parents: Array<int> }
// record  = shallow copy of the node; `children` is [] when the node had an array of
//           children (refilled on rebuild), otherwise copied as-is (null for files).
// parents[i] = global index of the parent of node i, -1 for the root.

const CHUNK_SIZE = 20000;

// Pre-order flatten without recursion (deep trees must not overflow the stack).
// Returns references to the original nodes; sliceChunk makes the copies.
function flattenTree(root) {
  const nodes   = [];
  const parents = [];
  if (!root) return { nodes, parents };
  const stack = [[root, -1]];
  while (stack.length) {
    const [node, parent] = stack.pop();
    const index = nodes.length;
    nodes.push(node);
    parents.push(parent);
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push([node.children[i], index]);
      }
    }
  }
  return { nodes, parents };
}

// Number of nodes in a tree (0 for a null root); iterative, like flattenTree.
function countNodes(root) {
  let n = 0;
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop();
    n++;
    if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);
  }
  return n;
}

function chunkCount(nodeCount, chunkSize = CHUNK_SIZE) {
  return Math.ceil(nodeCount / chunkSize);
}

// Chunk `index` of a flat list as a transferable { nodes, parents }; null if out of range.
function sliceChunk(flat, index, chunkSize = CHUNK_SIZE) {
  if (!Number.isInteger(index) || index < 0 || index >= chunkCount(flat.nodes.length, chunkSize)) return null;
  const start = index * chunkSize;
  const end   = Math.min(start + chunkSize, flat.nodes.length);
  const nodes = [];
  for (let i = start; i < end; i++) {
    const rec = { ...flat.nodes[i] };
    if (Array.isArray(rec.children)) rec.children = [];
    nodes.push(rec);
  }
  return { nodes, parents: flat.parents.slice(start, end) };
}

// Rebuild the tree from all chunks in order. Records are reused (children refilled in place).
// Throws a clear Error on malformed input (the chunks may come from the renderer).
function rebuildTree(chunks) {
  const all = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.nodes.length; i++) {
      const rec    = chunk.nodes[i];
      const parent = chunk.parents[i];
      const index  = all.length;
      if (rec === null || typeof rec !== 'object') {
        throw new Error(`Invalid tree: node ${index} is not an object`);
      }
      if (index === 0) {
        if (parent !== -1) throw new Error('Invalid tree: first node must be the root');
      } else {
        if (!Number.isInteger(parent) || parent < 0 || parent >= index) {
          throw new Error(`Invalid tree: node ${index} has invalid parent ${parent}`);
        }
        if (!Array.isArray(all[parent].children)) {
          throw new Error(`Invalid tree: parent ${parent} of node ${index} cannot have children`);
        }
        all[parent].children.push(rec);
      }
      all.push(rec);
    }
  }
  return all.length ? all[0] : null;
}

module.exports = { CHUNK_SIZE, flattenTree, countNodes, chunkCount, sliceChunk, rebuildTree };
