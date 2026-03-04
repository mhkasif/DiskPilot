'use strict';
const { app, dialog, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

const getWin = () =>
  BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

let manualCheck = false;

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  // Enable logging so update issues are visible in the console
  autoUpdater.logger = require('electron').app.isPackaged
    ? {
        info:  (...args) => console.log('[updater]', ...args),
        warn:  (...args) => console.warn('[updater]', ...args),
        error: (...args) => console.error('[updater]', ...args),
        debug: (...args) => console.log('[updater:debug]', ...args),
      }
    : console;
  autoUpdater.logger.transports = undefined; // suppress electron-log fallback

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update…');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err?.message || String(err));
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
        if (response === 0) autoUpdater.downloadUpdate();
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
    console.log(`[updater] Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.setProgressBar(-1); // remove progress bar
    }
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
        if (response === 0) {
          try {
            // isSilent = false, isForceRunAfter = true
            autoUpdater.quitAndInstall(false, true);
          } catch (err) {
            console.error('[updater] quitAndInstall failed:', err);
            // Fallback: open releases page if auto-install fails (unsigned macOS apps)
            const { shell } = require('electron');
            shell.openExternal(`https://github.com/mhkasif/DiskPilot/releases/tag/v${info.version}`);
            app.quit();
          }
        }
      });
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
