'use strict';
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

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

module.exports = function registerSnapshotsIpc() {
  ipcMain.handle('snapshot:save', async (_, { tree, rootPath }) => {
    if (!tree || !rootPath) return { ok: false, error: 'Invalid payload' };
    try {
      const dir = getSnapshotsDir();
      const id = `snap-${Date.now()}`;
      const filePath = path.join(dir, `${id}.json`);

      const prunedTree = pruneNode(tree);
      const payload = {
        version: app.getVersion(),
        id,
        rootPath,
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
