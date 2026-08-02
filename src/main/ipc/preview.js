'use strict';
const { ipcMain, BrowserWindow, shell } = require('electron');
const fs = require('fs');

module.exports = function registerPreviewIpc() {
  ipcMain.handle('fs:quickLook', async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }

    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (process.platform === 'darwin' && win && typeof win.previewFile === 'function') {
        win.previewFile(filePath);
        return { ok: true, native: true };
      } else {
        // Fallback for Windows and Linux
        await shell.openPath(filePath);
        return { ok: true, native: false };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
};
