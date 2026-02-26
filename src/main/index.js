'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');

// Set app name early so the dock / taskbar shows "DiskPilot" not "Electron"
app.name = 'DiskPilot';

const buildMenu          = require('./menu');
const registerFilesystem = require('./ipc/filesystem');
const registerScanner    = require('./ipc/scanner');
const registerFileops    = require('./ipc/fileops');

let mainWindow;

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const iconFile = process.platform === 'win32'
    ? path.join(__dirname, '../../assets/favicon.ico')
    : path.join(__dirname, '../../assets/playstore.png');

  mainWindow = new BrowserWindow({
    width : 1320,
    height: 820,
    minWidth : 900,
    minHeight: 600,
    webPreferences: {
      preload          : path.join(__dirname, '../preload/index.js'),
      contextIsolation : true,
      nodeIntegration  : false,
    },
    titleBarStyle        : process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition : { x: 16, y: 18 },
    backgroundColor      : '#ffffff',
    title                : 'DiskPilot',
    icon                 : iconFile,
    show                 : false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Set macOS dock icon explicitly (BrowserWindow.icon is ignored on macOS)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, '../../assets/playstore.png'));
  }

  // Customise the About panel so it shows DiskPilot info, not Electron's
  const appIcon = nativeImage.createFromPath(
    path.join(__dirname, '../../assets/playstore.png')
  );
  app.setAboutPanelOptions({
    applicationName   : 'DiskPilot',
    applicationVersion: '1.0.0',
    version           : '',
    copyright         : 'MIT License — mhkasif97@gmail.com',
    credits           : 'Your disk space, visualized & reclaimed.',
    icon              : appIcon,        // macOS/Windows use nativeImage, not iconPath
  });

  createWindow();
  buildMenu(mainWindow);
  registerFilesystem(mainWindow);
  registerScanner();
  registerFileops(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
