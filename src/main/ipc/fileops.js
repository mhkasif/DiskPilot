'use strict';
const fs   = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, clipboard, BrowserWindow } = require('electron');

module.exports = function registerFileopIpc() {
  // Batch delete: show one confirmation, then delete all
  ipcMain.handle('fs:deleteBatch', async (_, itemPaths) => {
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
    try { isDir = fs.lstatSync(paths[0]).isDirectory(); } catch (_) {}
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

    for (const itemPath of paths) {
      try {
        let isDir = false;
        try { isDir = fs.lstatSync(itemPath).isDirectory(); } catch (_) {}
        if (useTrash) {
          await shell.trashItem(itemPath);
        } else {
          if (isDir) fs.rmSync(itemPath, { recursive: true, force: true });
          else       fs.unlinkSync(itemPath);
        }
        deletedPaths.push(itemPath);
      } catch (err) {
        errors.push({ path: itemPath, error: err.message });
      }
    }

    return {
      ok          : deletedPaths.length > 0,
      deletedPaths,
      errors,
      method      : useTrash ? 'trash' : 'permanent',
    };
  });

  // Single delete (for context menu / single-item callers)
  ipcMain.handle('fs:delete', async (_, itemPath) => {
    const name  = path.basename(itemPath);
    let   isDir = false;
    try { isDir = fs.lstatSync(itemPath).isDirectory(); } catch (_) {}

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
      if (isDir) fs.rmSync(itemPath, { recursive: true, force: true });
      else       fs.unlinkSync(itemPath);
      return { ok: true, method: 'permanent' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:open',      (_, p) => shell.openPath(p));
  ipcMain.handle('fs:showInDir', (_, p) => { shell.showItemInFolder(p); });
  ipcMain.handle('fs:copyPath',  (_, p) => { clipboard.writeText(p); });
};
