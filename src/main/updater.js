'use strict';
const { app, dialog, shell, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

const getWin = () =>
  BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

// Send update events to the renderer
function sendToRenderer(channel, data) {
  const win = getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

let manualCheck = false;

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.logger = {
    info:  (...args) => console.log('[updater]', ...args),
    warn:  (...args) => console.warn('[updater]', ...args),
    error: (...args) => console.error('[updater]', ...args),
    debug: (...args) => console.log('[updater:debug]', ...args),
  };
  autoUpdater.logger.transports = undefined;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update…');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err?.message || String(err));
    sendToRenderer('update:error', { message: err?.message || String(err) });
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
    console.log('[updater] Update available:', info.version);
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
        if (response === 0) {
          sendToRenderer('update:downloading', { version: info.version, percent: 0 });
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] No update available. Latest:', info?.version);
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

  autoUpdater.on('download-progress', (progress) => {
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.setProgressBar(progress.percent / 100);
    }
    sendToRenderer('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
    console.log(`[updater] Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.setProgressBar(-1);
    }
    sendToRenderer('update:downloaded', { version: info.version });

    // Wait a moment for the renderer to show the "downloaded" state
    setTimeout(() => {
      const w = getWin();
      if (!w || w.isDestroyed()) return;

      dialog
        .showMessageBox(w, {
          type: 'info',
          title: 'Update Ready',
          message: `DiskPilot v${info.version} has been downloaded`,
          detail: 'Restart now to apply the update?',
          buttons: ['Restart Now', 'Download Manually', 'Later'],
          defaultId: 0,
          cancelId: 2,
        })
        .then(({ response }) => {
          if (response === 0) {
            try {
              autoUpdater.quitAndInstall(false, true);
            } catch (err) {
              console.error('[updater] quitAndInstall failed:', err);
              shell.openExternal(`https://github.com/mhkasif/DiskPilot/releases/tag/v${info.version}`);
              app.quit();
            }
          } else if (response === 1) {
            shell.openExternal(`https://github.com/mhkasif/DiskPilot/releases/tag/v${info.version}`);
          }
        });
    }, 500);
  });

  // Delayed auto-check so the window can finish loading first
  setTimeout(() => {
    console.log('[updater] Auto-checking for updates (app version:', app.getVersion(), ')');
    manualCheck = false;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Auto-check failed:', err?.message || String(err));
    });
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
  console.log('[updater] Manual check for updates (app version:', app.getVersion(), ')');
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] Manual check failed:', err?.message || String(err));
  });
}

module.exports = setupAutoUpdater;
module.exports.checkForUpdatesManually = checkForUpdatesManually;
