'use strict';
const fs   = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, clipboard } = require('electron');

module.exports = function registerFileopIpc(mainWindow) {
  ipcMain.handle('fs:delete', async (_, itemPath) => {
    const name  = path.basename(itemPath);
    let   isDir = false;
    try { isDir = fs.lstatSync(itemPath).isDirectory(); } catch (_) {}

    const { response } = await dialog.showMessageBox(mainWindow, {
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
