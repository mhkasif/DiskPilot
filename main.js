const {
  app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu
} = require('electron');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { promisify } = require('util');

const readdirAsync = promisify(fs.readdir);
const lstatAsync   = promisify(fs.lstat);

let mainWindow;

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width : 1320,
    height: 820,
    minWidth : 900,
    minHeight: 600,
    webPreferences: {
      preload          : path.join(__dirname, 'preload.js'),
      contextIsolation : true,
      nodeIntegration  : false,
    },
    titleBarStyle        : process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition : { x: 16, y: 18 },
    backgroundColor      : '#ffffff',
    title                : 'DiskPilot',
    show                 : false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile('index.html');
}

// ─── Application Menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const send = (ch) => () => mainWindow && mainWindow.webContents.send(ch);

  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Scan Directory…', accelerator: 'CmdOrCtrl+O', click: send('menu:scan') },
        { label: 'Refresh',         accelerator: 'F5',           click: send('menu:refresh') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Expand All',   click: send('menu:expand-all') },
        { label: 'Collapse All', click: send('menu:collapse-all') },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: drives / paths ─────────────────────────────────────────────────────

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
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

// ─── IPC: scan ───────────────────────────────────────────────────────────────

const activeScans = new Map();    // scanId → { cancelled }
let yieldCounter  = 0;

async function scanNode(nodePath, sender, scanId, ctrl) {
  if (ctrl.cancelled) return null;

  // Yield every 200 entries to keep IPC alive
  if (++yieldCounter % 200 === 0)
    await new Promise(r => setImmediate(r));

  const node = {
    name    : path.basename(nodePath) || nodePath,
    path    : nodePath,
    isDir   : false,
    size    : 0,
    allocated: 0,
    files   : 0,
    folders : 0,
    mtime   : 0,
    ext     : '',
    error   : false,
    children: null,
  };

  let st;
  try { st = await lstatAsync(nodePath); }
  catch (_) { node.error = true; return node; }

  node.mtime = st.mtimeMs;

  if (st.isSymbolicLink()) {
    node.size      = st.size;
    node.allocated = align(st.size);
    node.files     = 1;
    node.isSymlink = true;
    return node;
  }

  if (st.isFile()) {
    node.size      = st.size;
    node.allocated = align(st.size);
    node.files     = 1;
    node.ext       = path.extname(nodePath).toLowerCase().slice(1);
    return node;
  }

  if (st.isDirectory()) {
    node.isDir    = true;
    node.children = [];

    let entries;
    try { entries = await readdirAsync(nodePath, { withFileTypes: true }); }
    catch (_) { node.error = true; return node; }

    for (const e of entries) {
      const childPath = path.join(nodePath, e.name);
      const child     = await scanNode(childPath, sender, scanId, ctrl);
      if (!child) return null; // cancelled
      node.size      += child.size;
      node.allocated += child.allocated;
      if (child.isDir) {
        node.folders += 1 + child.folders;
        node.files   += child.files;
      } else {
        node.files   += 1;
      }
      node.children.push(child);
    }

    // Sort by size descending
    node.children.sort((a, b) => b.size - a.size);

    // Progress ping
    try {
      sender.send('scan:progress', { scanId, path: nodePath, size: node.size });
    } catch (_) {}
  }

  return node;
}

function align(bytes, block = 4096) {
  return Math.ceil(bytes / block) * block;
}

ipcMain.handle('fs:scan', async (event, dirPath) => {
  const scanId = `${Date.now()}`;
  const ctrl   = { cancelled: false };
  activeScans.set(scanId, ctrl);
  yieldCounter = 0;

  try {
    const data = await scanNode(dirPath, event.sender, scanId, ctrl);
    activeScans.delete(scanId);
    if (!data) return { ok: false, cancelled: true };
    return { ok: true, data, scanId };
  } catch (err) {
    activeScans.delete(scanId);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:cancelScan', (_, scanId) => {
  const ctrl = activeScans.get(scanId);
  if (ctrl) ctrl.cancelled = true;
});

// ─── IPC: file operations ─────────────────────────────────────────────────────

ipcMain.handle('fs:delete', async (_, itemPath) => {
  const name   = path.basename(itemPath);
  let   isDir  = false;
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

ipcMain.handle('fs:open',       (_, p) => shell.openPath(p));
ipcMain.handle('fs:showInDir',  (_, p) => { shell.showItemInFolder(p); });
ipcMain.handle('fs:copyPath',   (_, p) => { clipboard.writeText(p); });

ipcMain.handle('fs:exists', (_, p) => {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
});
