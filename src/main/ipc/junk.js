'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { ipcMain } = require('electron');

const readdirAsync = promisify(fs.readdir);
const lstatAsync = promisify(fs.lstat);

let activeJunkScan = null;

async function getDirectorySize(dirPath, ctrl) {
  let total = 0;
  try {
    const entries = await readdirAsync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (ctrl && ctrl.cancelled) break;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const st = await lstatAsync(fullPath);
        if (st.isDirectory()) {
          total += await getDirectorySize(fullPath, ctrl);
        } else if (st.isFile()) {
          total += (st.blocks != null) ? st.blocks * 512 : st.size;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return total;
}

const TARGET_PROJECT_DIRS = new Set([
  'node_modules', 'dist', '.next', 'build', 'target', '.gradle', 'DerivedData',
  '.docker', '__pycache__', '.pytest_cache', '.turbo', 'vendor'
]);

async function scanProjectArtifacts(rootDir, ctrl, sender, results) {
  if (ctrl.cancelled) return;

  let entries;
  try {
    entries = await readdirAsync(rootDir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (const entry of entries) {
    if (ctrl.cancelled) break;
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(rootDir, entry.name);

    if (TARGET_PROJECT_DIRS.has(entry.name)) {
      const size = await getDirectorySize(fullPath, ctrl);
      results.push({
        category: 'Developer Artifacts',
        path: fullPath,
        size,
        kind: entry.name,
        badge: 'safe'
      });
      if (sender) {
        try { sender.send('junk:progress', { found: results.length, current: fullPath }); } catch (_) {}
      }
      // Stop descending into a matched folder!
      continue;
    }

    // Skip scanning inside system hidden folders or deep system dirs
    if (entry.name.startsWith('.') && entry.name !== '.next' && entry.name !== '.gradle' && entry.name !== '.turbo' && entry.name !== '.pytest_cache') {
      continue;
    }

    // Do not descend into Library or System directories when looking for dev projects
    if (entry.name === 'Library' || entry.name === 'System' || entry.name === 'Applications') {
      continue;
    }

    await scanProjectArtifacts(fullPath, ctrl, sender, results);
  }
}

function getPlatformSystemCaches() {
  const home = os.homedir();
  const platform = process.platform;
  const list = [];

  if (platform === 'darwin') {
    list.push(
      { category: 'System Caches', path: path.join(home, 'Library/Caches'), badge: 'caution' },
      { category: 'System Logs', path: path.join(home, 'Library/Logs'), badge: 'caution' },
      { category: 'Package Managers', path: path.join(home, '.npm'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, 'Library/Caches/Yarn'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, 'Library/pnpm/store'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, 'Library/Caches/pip'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, 'Library/Caches/Homebrew'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.cargo/registry'), badge: 'safe' }
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
    list.push(
      { category: 'System Caches', path: path.join(localAppData, 'Temp'), badge: 'caution' },
      { category: 'Package Managers', path: path.join(localAppData, 'npm-cache'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(localAppData, 'Yarn/Cache'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(localAppData, 'pnpm/store'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(localAppData, 'pip/Cache'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.cargo/registry'), badge: 'safe' }
    );
  } else {
    // Linux
    list.push(
      { category: 'System Caches', path: path.join(home, '.cache'), badge: 'caution' },
      { category: 'System Logs', path: '/var/log', badge: 'readonly' },
      { category: 'Package Managers', path: path.join(home, '.npm'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.cache/yarn'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.local/share/pnpm/store'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.cache/pip'), badge: 'safe' },
      { category: 'Package Managers', path: path.join(home, '.cargo/registry'), badge: 'safe' }
    );
  }

  return list;
}

async function scanJunkInternal(scanRoot, sender) {
  const ctrl = { cancelled: false };
  activeJunkScan = ctrl;
  const results = [];

  // 1. Scan System & Package Manager Caches
  const systemCaches = getPlatformSystemCaches();
  for (const item of systemCaches) {
    if (ctrl.cancelled) break;
    if (fs.existsSync(item.path)) {
      const size = await getDirectorySize(item.path, ctrl);
      if (size > 0) {
        results.push({
          category: item.category,
          path: item.path,
          size,
          kind: path.basename(item.path),
          badge: item.badge
        });
      }
    }
  }

  // 2. Scan Developer Project Artifacts inside search root
  const root = scanRoot || os.homedir();
  await scanProjectArtifacts(root, ctrl, sender, results);

  activeJunkScan = null;
  return { ok: !ctrl.cancelled, cancelled: ctrl.cancelled, items: results };
}

module.exports = function registerJunkIpc() {
  ipcMain.handle('junk:scan', async (event, scanRoot) => {
    try {
      return await scanJunkInternal(scanRoot, event.sender);
    } catch (err) {
      activeJunkScan = null;
      return { ok: false, error: err.message, items: [] };
    }
  });

  ipcMain.handle('junk:cancel', () => {
    if (activeJunkScan) activeJunkScan.cancelled = true;
  });
};
