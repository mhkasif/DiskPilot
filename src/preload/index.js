const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dt', {
  // ── platform ───────────────────────────────────────────────────────────────
  platform: process.platform,

  // ── filesystem ────────────────────────────────────────────────────────────
  getDrives    : ()  => ipcRenderer.invoke('fs:drives'),
  getHomeDir   : ()  => ipcRenderer.invoke('fs:homeDir'),
  selectDir    : ()  => ipcRenderer.invoke('fs:selectDir'),
  scan         : (p, id) => ipcRenderer.invoke('fs:scan', p, id),
  cancelScan   : (id)=> ipcRenderer.invoke('fs:cancelScan', id),

  // ── file operations ───────────────────────────────────────────────────────
  deleteItem   : (p) => ipcRenderer.invoke('fs:delete', p),
  openItem     : (p) => ipcRenderer.invoke('fs:open', p),
  showInDir    : (p) => ipcRenderer.invoke('fs:showInDir', p),
  copyPath     : (p) => ipcRenderer.invoke('fs:copyPath', p),
  exists       : (p) => ipcRenderer.invoke('fs:exists', p),

  // ── IPC events ────────────────────────────────────────────────────────────
  onScanProgress : (cb) => ipcRenderer.on('scan:progress', (_, d) => cb(d)),
  offScanProgress: ()   => ipcRenderer.removeAllListeners('scan:progress'),

  onMenu: (cb) => {
    ipcRenderer.on('menu:scan',         () => cb('scan'));
    ipcRenderer.on('menu:refresh',      () => cb('refresh'));
    ipcRenderer.on('menu:expand-all',   () => cb('expand-all'));
    ipcRenderer.on('menu:collapse-all', () => cb('collapse-all'));
  },
});
