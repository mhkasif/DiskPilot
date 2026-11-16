'use strict';
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const { stateFor, existingState } = require('../senderState');
const { CHUNK_SIZE, rebuildTree } = require('../treeTransfer');

function getSnapshotsDir() {
  const dir = path.join(app.getPath('userData'), 'snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Prune leaf nodes under 500 KB to keep JSON files compact
function pruneNode(node) {
  if (!node) return null;
  const pruned = {
    name: node.name,
    path: node.path,
    isDir: node.isDir,
    size: node.size,
    allocated: node.allocated,
    files: node.files,
    folders: node.folders,
    mtime: node.mtime,
  };

  if (node.isDir && node.children) {
    pruned.children = node.children
      .map(c => pruneNode(c))
      .filter(c => c !== null && (c.isDir || c.size >= 500 * 1024));
  }
  return pruned;
}

// Snapshot uploads in progress live in the calling window's state (senderState):
// uploadId -> { rootPath, nodeCount, received, chunks }.
// The renderer sends the tree in bounded chunks; never as one IPC message.
let uploadCounter = 0;

// An upload is only reachable from the window that began it.
function ownUpload(event, uploadId) {
  const st = existingState(event.sender);
  return st ? st.uploads.get(uploadId) : undefined;
}

module.exports = function registerSnapshotsIpc() {
  ipcMain.handle('snapshot:saveBegin', (event, payload) => {
    const { rootPath, nodeCount } = payload || {};
    if (!rootPath || !Number.isInteger(nodeCount) || nodeCount < 1) {
      return { ok: false, error: 'Invalid payload' };
    }
    const st = stateFor(event.sender);
    const uploadId = `up-${Date.now()}-${++uploadCounter}`;
    st.uploads.set(uploadId, { rootPath, nodeCount, received: 0, chunks: [] });
    return { ok: true, uploadId };
  });

  ipcMain.handle('snapshot:saveChunk', (event, uploadId, chunk) => {
    const up = ownUpload(event, uploadId);
    if (!up) return { ok: false, error: 'Unknown upload' };
    const valid = chunk && Array.isArray(chunk.nodes) && Array.isArray(chunk.parents) &&
      chunk.nodes.length > 0 &&
      chunk.nodes.length <= CHUNK_SIZE &&
      chunk.nodes.length === chunk.parents.length &&
      up.received + chunk.nodes.length <= up.nodeCount &&
      chunk.parents.every(Number.isInteger);
    if (!valid) {
      existingState(event.sender).uploads.delete(uploadId);
      return { ok: false, error: 'Invalid chunk' };
    }
    up.chunks.push(chunk);
    up.received += chunk.nodes.length;
    return { ok: true };
  });

  ipcMain.handle('snapshot:saveAbort', (event, uploadId) => {
    if (ownUpload(event, uploadId)) existingState(event.sender).uploads.delete(uploadId);
    return { ok: true };
  });

  ipcMain.handle('snapshot:saveCommit', async (event, uploadId) => {
    const up = ownUpload(event, uploadId);
    if (!up) return { ok: false, error: 'Unknown upload' };
    existingState(event.sender).uploads.delete(uploadId);
    if (up.received !== up.nodeCount) return { ok: false, error: 'Incomplete upload' };
    try {
      const tree = rebuildTree(up.chunks);
      const dir = getSnapshotsDir();
      const id = `snap-${Date.now()}`;
      const filePath = path.join(dir, `${id}.json`);

      const prunedTree = pruneNode(tree);
      const payload = {
        version: app.getVersion(),
        id,
        rootPath: up.rootPath,
        savedAt: Date.now(),
        tree: prunedTree,
      };

      await fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8');
      return { ok: true, id, savedAt: payload.savedAt };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('snapshot:list', async () => {
    try {
      const dir = getSnapshotsDir();
      const files = await fs.promises.readdir(dir);
      const list = [];

      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const filePath = path.join(dir, f);
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const data = JSON.parse(raw);
          list.push({
            id: data.id || f.replace('.json', ''),
            rootPath: data.rootPath,
            savedAt: data.savedAt,
            totalSize: data.tree ? data.tree.size : 0,
            files: data.tree ? data.tree.files : 0,
            folders: data.tree ? data.tree.folders : 0,
          });
        } catch (_) {}
      }

      list.sort((a, b) => b.savedAt - a.savedAt);
      return { ok: true, list };
    } catch (err) {
      return { ok: false, error: err.message, list: [] };
    }
  });

  ipcMain.handle('snapshot:load', async (_, id) => {
    try {
      const dir = getSnapshotsDir();
      const filePath = path.join(dir, `${id}.json`);
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('snapshot:delete', async (_, id) => {
    try {
      const dir = getSnapshotsDir();
      const filePath = path.join(dir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
};
