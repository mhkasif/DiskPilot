'use strict';
const fs   = require('fs');
const path = require('path');
const { promisify } = require('util');
const { ipcMain } = require('electron');
const { stateFor, existingState } = require('../senderState');
const { flattenTree, chunkCount, sliceChunk } = require('../treeTransfer');

const readdirAsync = promisify(fs.readdir);
const lstatAsync   = promisify(fs.lstat);

// The whole tree must never travel in one IPC message (V8 serializer limit ~2 GB): a finished
// scan is kept per window (senderState) and pulled in chunks by fs:scanChunk.
let yieldCounter  = 0;

function align(bytes, block = 4096) {
  return Math.ceil(bytes / block) * block;
}

async function scanNode(nodePath, sender, scanId, ctrl, seenInodes) {
  if (ctrl.cancelled) return null;

  if (++yieldCounter % 200 === 0)
    await new Promise(r => setImmediate(r));

  const node = {
    name    : path.basename(nodePath) || nodePath,
    path    : nodePath,
    isDir   : false,
    size    : 0,
    allocated: 0,
    files   : 0,
    folders : 0,
    mtime   : 0,
    ext     : '',
    error   : false,
    children: null,
  };

  let st;
  try { st = await lstatAsync(nodePath); }
  catch (_) { node.error = true; return node; }

  node.mtime = st.mtimeMs;
  node.atime = st.atimeMs || 0;
  node.birthtime = st.birthtimeMs || 0;

  if (st.isSymbolicLink()) {
    // Record symlink itself (don't follow — avoids infinite loops and double-counting)
    node.size      = st.size;
    node.allocated = align(st.size);
    node.files     = 1;
    node.isSymlink = true;
    return node;
  }

  if (st.isFile()) {
    // Deduplicate hardlinks: only count the first path we see for a given inode
    const inodeKey = `${st.dev}:${st.ino}`;
    if (st.nlink > 1 && seenInodes.has(inodeKey)) {
      // Hardlink already counted via another path – show in tree but with 0 size
      node.files       = 1;
      node.isDuplicate = true;
    } else {
      if (st.nlink > 1) seenInodes.add(inodeKey);
      // Use actual disk blocks (st.blocks * 512) for accurate size on APFS/HFS+.
      // st.size is the logical size which over-reports due to clones, compression,
      // and sparse files. Falls back to st.size on Windows where blocks is undefined.
      node.size      = (st.blocks != null) ? st.blocks * 512 : st.size;
      node.allocated = (st.blocks != null) ? st.blocks * 512 : align(st.size);
      node.files     = 1;
      node.ext       = path.extname(nodePath).toLowerCase().slice(1);
    }
    return node;
  }

  if (st.isDirectory()) {
    node.isDir    = true;
    node.children = [];

    let entries;
    try { entries = await readdirAsync(nodePath, { withFileTypes: true }); }
    catch (_) { node.error = true; return node; }

    for (const e of entries) {
      const childPath = path.join(nodePath, e.name);
      const child     = await scanNode(childPath, sender, scanId, ctrl, seenInodes);
      if (!child) return null;
      node.size      += child.size;
      node.allocated += child.allocated;
      if (child.isDir) {
        node.folders += 1 + child.folders;
        node.files   += child.files;
      } else {
        node.files   += 1;
      }
      node.children.push(child);
    }

    node.children.sort((a, b) => b.size - a.size);

    try {
      sender.send('scan:progress', { scanId, path: nodePath, size: node.size });
    } catch (_) {}
  }

  return node;
}

// The caller's finished scan, if scanId is its current one.
function ownTransfer(event, scanId) {
  const st = existingState(event.sender);
  return st && st.transfer && st.transfer.id === scanId ? st : null;
}

module.exports = function registerScannerIpc() {
  ipcMain.handle('fs:scan', async (event, dirPath, scanId) => {
    if (!scanId) scanId = `${Date.now()}`;
    const st   = stateFor(event.sender);
    const scan = { id: scanId, ctrl: { cancelled: false } };
    if (st.scan) st.scan.ctrl.cancelled = true;
    st.scan = scan;
    st.transfer = null;
    yieldCounter = 0;

    try {
      const seenInodes = new Set();
      const data = await scanNode(dirPath, event.sender, scanId, scan.ctrl, seenInodes);
      // Keep the result only if this scan is still the window's current one and the window lives.
      const current = !scan.ctrl.cancelled && !event.sender.isDestroyed();
      if (st.scan === scan) st.scan = null;
      if (!data || !current) return { ok: false, cancelled: true };
      const flat = flattenTree(data);
      st.transfer = { id: scanId, flat };
      return { ok: true, scanId, nodeCount: flat.nodes.length, chunkCount: chunkCount(flat.nodes.length) };
    } catch (err) {
      if (st.scan === scan) st.scan = null;
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:scanChunk', (event, scanId, index) => {
    const st = ownTransfer(event, scanId);
    if (!st) return { ok: false, error: 'Scan result is no longer available' };
    const chunk = sliceChunk(st.transfer.flat, index);
    if (!chunk) return { ok: false, error: 'Invalid chunk index' };
    return { ok: true, nodes: chunk.nodes, parents: chunk.parents };
  });

  ipcMain.handle('fs:releaseScan', (event, scanId) => {
    const st = ownTransfer(event, scanId);
    if (st) st.transfer = null;
  });

  ipcMain.handle('fs:cancelScan', (event, scanId) => {
    const st = existingState(event.sender);
    if (!st) return;
    if (st.scan && st.scan.id === scanId) st.scan.ctrl.cancelled = true;
    if (st.transfer && st.transfer.id === scanId) st.transfer = null;
  });
};
