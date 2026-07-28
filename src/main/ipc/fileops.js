'use strict';
const fs   = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, clipboard, BrowserWindow } = require('electron');

module.exports = function registerFileopIpc() {
  // Cancellation flag for the in-progress batch delete (only one runs at a time)
  let cancelDelete = false;

  // Batch delete: show one confirmation, then delete all (async + progress + cancel)
  ipcMain.handle('fs:deleteBatch', async (event, itemPaths) => {
    const paths = Array.isArray(itemPaths) ? itemPaths : [itemPaths];
    if (!paths.length) return { ok: false, cancelled: true, deletedPaths: [], errors: [] };

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

    // Build message: "Delete 10 items?" with sample names
    const count = paths.length;
    const sampleNames = paths.slice(0, 3).map(p => path.basename(p));
    const message = count === 1
      ? `Delete "${sampleNames[0]}"?`
      : `Delete ${count} items?`;
    let isDir = false;
    try { isDir = (await fs.promises.lstat(paths[0])).isDirectory(); } catch (_) {}
    const detail = count === 1
      ? (isDir
          ? 'This will permanently remove the folder and ALL its contents.'
          : `"${sampleNames[0]}" will be permanently deleted.`)
      : (count <= 3
          ? sampleNames.join(', ')
          : `${sampleNames.join(', ')} and ${count - 3} more`);

    const { response } = await dialog.showMessageBox(win, {
      type     : 'warning',
      title    : 'Confirm Delete',
      message,
      detail   : count > 1 ? `${detail}\n\nSelected items will be removed.` : detail,
      buttons  : ['Move to Trash', 'Delete Permanently', 'Cancel'],
      defaultId: 0,
      cancelId : 2,
    });

    if (response === 2) return { ok: false, cancelled: true, deletedPaths: [], errors: [] };

    const deletedPaths = [];
    const errors = [];
    const useTrash = response === 0;
    const total = paths.length;

    cancelDelete = false;

    const sendProgress = (current, currentPath) => {
      try {
        event.sender.send('delete:progress', {
          current,
          total,
          path   : currentPath,
          deleted: deletedPaths.length,
          failed : errors.length,
        });
      } catch (_) {}
    };

    for (let i = 0; i < paths.length; i++) {
      if (cancelDelete) break;

      const itemPath = paths[i];
      // Report which item we're about to process so the UI shows live progress
      sendProgress(i, itemPath);

      try {
        let isDir = false;
        try { isDir = (await fs.promises.lstat(itemPath)).isDirectory(); } catch (_) {}
        if (useTrash) {
          await shell.trashItem(itemPath);
        } else {
          if (isDir) await fs.promises.rm(itemPath, { recursive: true, force: true });
          else       await fs.promises.unlink(itemPath);
        }
        deletedPaths.push(itemPath);
      } catch (err) {
        errors.push({ path: itemPath, error: err.message });
      }

      // Yield to the event loop so the main process stays responsive
      await new Promise(r => setImmediate(r));
    }

    const cancelled = cancelDelete;
    cancelDelete = false;
    // Final progress tick (100% of whatever was processed)
    sendProgress(total, null);

    return {
      ok          : deletedPaths.length > 0,
      cancelled,
      deletedPaths,
      errors,
      method      : useTrash ? 'trash' : 'permanent',
    };
  });

  // Cancel an in-progress batch delete
  ipcMain.handle('fs:cancelDelete', () => { cancelDelete = true; });

  // Single delete (for context menu / single-item callers)
  ipcMain.handle('fs:delete', async (_, itemPath) => {
    const name  = path.basename(itemPath);
    let   isDir = false;
    try { isDir = (await fs.promises.lstat(itemPath)).isDirectory(); } catch (_) {}

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const { response } = await dialog.showMessageBox(win, {
      type     : 'warning',
      title    : 'Confirm Delete',
      message  : `Delete "${name}"?`,
      detail   : isDir
        ? `This will permanently remove the folder and ALL its contents.`
        : `"${name}" will be permanently deleted.`,
      buttons  : ['Move to Trash', 'Delete Permanently', 'Cancel'],
      defaultId: 0,
      cancelId : 2,
    });

    if (response === 2) return { ok: false, cancelled: true };

    try {
      if (response === 0) {
        await shell.trashItem(itemPath);
        return { ok: true, method: 'trash' };
      }
      if (isDir) await fs.promises.rm(itemPath, { recursive: true, force: true });
      else       await fs.promises.unlink(itemPath);
      return { ok: true, method: 'permanent' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:open',      (_, p) => shell.openPath(p));
  ipcMain.handle('fs:showInDir', (_, p) => { shell.showItemInFolder(p); });
  ipcMain.handle('fs:copyPath',  (_, p) => { clipboard.writeText(p); });
};
