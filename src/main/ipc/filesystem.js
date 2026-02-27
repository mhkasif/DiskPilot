'use strict';
const fs   = require('fs');
const os   = require('os');
const { ipcMain, dialog, BrowserWindow } = require('electron');

module.exports = function registerFilesystemIpc() {
  ipcMain.handle('fs:drives', async () => {
    if (process.platform === 'win32') {
      const drives = [];
      for (let c = 65; c <= 90; c++) {
        const d = `${String.fromCharCode(c)}:\\`;
        try { fs.accessSync(d); drives.push(d); } catch (_) {}
      }
      return drives;
    }
    if (process.platform === 'darwin') {
      try {
        const vols = fs.readdirSync('/Volumes');
        return vols
          .map(v => `/Volumes/${v}`)
          .filter(v => { try { fs.accessSync(v); return true; } catch (_) { return false; } });
      } catch (_) { return ['/']; }
    }
    return ['/'];
  });

  ipcMain.handle('fs:homeDir', () => os.homedir());

  ipcMain.handle('fs:selectDir', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('fs:exists', (_, p) => {
    try { fs.accessSync(p); return true; } catch (_) { return false; }
  });
};
