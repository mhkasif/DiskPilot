const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dt', {
  // ── platform ───────────────────────────────────────────────────────────────
  platform: process.platform,
  appVersion: ipcRenderer.sendSync('app:version'),

  // ── filesystem ────────────────────────────────────────────────────────────
  getDrives    : ()  => ipcRenderer.invoke('fs:drives'),
  getHomeDir   : ()  => ipcRenderer.invoke('fs:homeDir'),
  selectDir    : ()  => ipcRenderer.invoke('fs:selectDir'),
  scan         : (p, id) => ipcRenderer.invoke('fs:scan', p, id),
  cancelScan   : (id)=> ipcRenderer.invoke('fs:cancelScan', id),

  // ── file operations ───────────────────────────────────────────────────────
  deleteItem   : (p) => ipcRenderer.invoke('fs:delete', p),
  deleteItems  : (paths) => ipcRenderer.invoke('fs:deleteBatch', paths),
  cancelDelete : ()  => ipcRenderer.invoke('fs:cancelDelete'),
  openItem     : (p) => ipcRenderer.invoke('fs:open', p),
  showInDir    : (p) => ipcRenderer.invoke('fs:showInDir', p),
  copyPath     : (p) => ipcRenderer.invoke('fs:copyPath', p),
  exists       : (p) => ipcRenderer.invoke('fs:exists', p),
  quickLook    : (p) => ipcRenderer.invoke('fs:quickLook', p),

  // ── duplicates ─────────────────────────────────────────────────────────────
  findDuplicates  : (candidates) => ipcRenderer.invoke('dup:find', candidates),
  cancelDuplicates: () => ipcRenderer.invoke('dup:cancel'),
  getThumbnail    : (p) => ipcRenderer.invoke('dup:thumbnail', p),
  onDupProgress   : (cb) => ipcRenderer.on('dup:progress', (_, d) => cb(d)),
  offDupProgress  : () => ipcRenderer.removeAllListeners('dup:progress'),

  // ── junk sweeper ───────────────────────────────────────────────────────────
  scanJunk     : (root) => ipcRenderer.invoke('junk:scan', root),
  cancelJunk   : () => ipcRenderer.invoke('junk:cancel'),
  onJunkProgress: (cb) => ipcRenderer.on('junk:progress', (_, d) => cb(d)),
  offJunkProgress: () => ipcRenderer.removeAllListeners('junk:progress'),

  // ── snapshots ──────────────────────────────────────────────────────────────
  saveSnapshot  : (payload) => ipcRenderer.invoke('snapshot:save', payload),
  listSnapshots : () => ipcRenderer.invoke('snapshot:list'),
  loadSnapshot  : (id) => ipcRenderer.invoke('snapshot:load', id),
  deleteSnapshot: (id) => ipcRenderer.invoke('snapshot:delete', id),

  // ── IPC events ────────────────────────────────────────────────────────────
  onScanProgress : (cb) => ipcRenderer.on('scan:progress', (_, d) => cb(d)),
  offScanProgress: ()   => ipcRenderer.removeAllListeners('scan:progress'),

  onDeleteProgress : (cb) => ipcRenderer.on('delete:progress', (_, d) => cb(d)),
  offDeleteProgress: ()   => ipcRenderer.removeAllListeners('delete:progress'),

  onMenu: (cb) => {
    ipcRenderer.on('menu:scan',         () => cb('scan'));
    ipcRenderer.on('menu:refresh',      () => cb('refresh'));
    ipcRenderer.on('menu:expand-all',   () => cb('expand-all'));
    ipcRenderer.on('menu:collapse-all', () => cb('collapse-all'));
    ipcRenderer.on('menu:about',        () => cb('about'));
  },

  // ── update events ───────────────────────────────────────────────────────
  onUpdateDownloading: (cb) => ipcRenderer.on('update:downloading', (_, d) => cb(d)),
  onUpdateProgress:    (cb) => ipcRenderer.on('update:progress',    (_, d) => cb(d)),
  onUpdateDownloaded:  (cb) => ipcRenderer.on('update:downloaded',  (_, d) => cb(d)),
  onUpdateManual:      (cb) => ipcRenderer.on('update:manual',      (_, d) => cb(d)),
  onUpdateError:       (cb) => ipcRenderer.on('update:error',       (_, d) => cb(d)),

  // ── analytics ─────────────────────────────────────────────────────────────
  trackEvent: (name, params) => ipcRenderer.invoke('analytics:track-event', name, params),
});
