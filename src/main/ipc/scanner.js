'use strict';
const fs   = require('fs');
const path = require('path');
const { promisify } = require('util');
const { ipcMain } = require('electron');

const readdirAsync = promisify(fs.readdir);
const lstatAsync   = promisify(fs.lstat);

const activeScans = new Map();
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

module.exports = function registerScannerIpc() {
  ipcMain.handle('fs:scan', async (event, dirPath, scanId) => {
    if (!scanId) scanId = `${Date.now()}`;
    const ctrl = { cancelled: false };
    activeScans.set(scanId, ctrl);
    yieldCounter = 0;

    try {
      const seenInodes = new Set();
    const data = await scanNode(dirPath, event.sender, scanId, ctrl, seenInodes);
      activeScans.delete(scanId);
      if (!data) return { ok: false, cancelled: true };
      return { ok: true, data, scanId };
    } catch (err) {
      activeScans.delete(scanId);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:cancelScan', (_, scanId) => {
    const ctrl = activeScans.get(scanId);
    if (ctrl) ctrl.cancelled = true;
  });
};
