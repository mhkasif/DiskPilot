'use strict';
const { app, dialog, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

const getWin = () =>
  BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

let manualCheck = false;

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    if (manualCheck) {
      const win = getWin();
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'error',
          title: 'Update Error',
          message: 'Could not check for updates',
          detail: err?.message || String(err),
        });
      }
    }
    manualCheck = false;
  });

  autoUpdater.on('update-available', (info) => {
    manualCheck = false;
    const win = getWin();
    if (!win || win.isDestroyed()) return;

    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `A new version of DiskPilot is available (v${info.version})`,
        detail: 'Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      const win = getWin();
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'info',
          title: 'No Updates',
          message: 'You are running the latest version of DiskPilot.',
        });
      }
    }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;

    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Ready',
        message: `DiskPilot v${info.version} has been downloaded`,
        detail: 'The update will be installed when you restart. Restart now?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Delayed auto-check so the window can finish loading first
  setTimeout(() => {
    manualCheck = false;
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

function checkForUpdatesManually() {
  if (!app.isPackaged) {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Development Mode',
        message: 'Auto-update is not available in development mode.',
      });
    }
    return;
  }
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = setupAutoUpdater;
module.exports.checkForUpdatesManually = checkForUpdatesManually;
