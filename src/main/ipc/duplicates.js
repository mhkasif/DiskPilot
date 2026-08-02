'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { ipcMain, nativeImage } = require('electron');

let activeDuplicateScan = null;

function hashStream(filePath, maxBytes = null) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const options = maxBytes ? { start: 0, end: maxBytes - 1 } : {};
    const stream = fs.createReadStream(filePath, options);

    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

async function findDuplicatesInternal(multiFileGroups, sender) {
  const ctrl = { cancelled: false };
  activeDuplicateScan = ctrl;

  let totalFiles = 0;
  for (const g of multiFileGroups) totalFiles += g.paths.length;
  let doneFiles = 0;

  const resultGroups = [];

  for (const group of multiFileGroups) {
    if (ctrl.cancelled) break;

    // 2. Stage A: Partial hash (first 64KB)
    const partialMap = new Map();
    for (const filePath of group.paths) {
      if (ctrl.cancelled) break;
      try {
        const pHash = await hashStream(filePath, 64 * 1024);
        if (!partialMap.has(pHash)) partialMap.set(pHash, []);
        partialMap.get(pHash).push(filePath);
      } catch (_) {
        // file unreadable, skip
      }
      doneFiles++;
      if (doneFiles % 10 === 0 && sender) {
        try { sender.send('dup:progress', { done: doneFiles, total: totalFiles }); } catch (_) {}
      }
      await new Promise(r => setImmediate(r));
    }

    // 3. Stage B: Full hash for partial hash collisions
    for (const [pHash, pPaths] of partialMap.entries()) {
      if (ctrl.cancelled) break;
      if (pPaths.length < 2) continue;

      const fullMap = new Map();
      for (const filePath of pPaths) {
        if (ctrl.cancelled) break;
        try {
          if (sender) {
            const fName = filePath.split(/[/\\]/).pop();
            try { sender.send('dup:progress', { done: doneFiles, total: totalFiles, text: `Deep hashing large file: ${fName}…` }); } catch (_) {}
          }
          const fHash = await hashStream(filePath);
          if (!fullMap.has(fHash)) fullMap.set(fHash, []);
          fullMap.get(fHash).push(filePath);
        } catch (_) {
          // skip
        }
      }

      for (const [fHash, fPaths] of fullMap.entries()) {
        if (fPaths.length > 1) {
          const filesWithMeta = fPaths.map(p => {
            let mtime = 0, birthtime = 0;
            try {
              const st = fs.statSync(p);
              mtime = st.mtimeMs;
              birthtime = st.birthtimeMs;
            } catch (_) {}
            return { path: p, mtime, birthtime };
          });
          resultGroups.push({
            hash: fHash,
            size: group.size,
            files: filesWithMeta,
          });
        }
      }
    }
  }

  activeDuplicateScan = null;
  return { ok: !ctrl.cancelled, cancelled: ctrl.cancelled, groups: resultGroups };
}

module.exports = function registerDuplicatesIpc() {
  ipcMain.handle('dup:find', async (event, candidates) => {
    try {
      return await findDuplicatesInternal(candidates || [], event.sender);
    } catch (err) {
      activeDuplicateScan = null;
      return { ok: false, error: err.message, groups: [] };
    }
  });

  ipcMain.handle('dup:cancel', () => {
    if (activeDuplicateScan) activeDuplicateScan.cancelled = true;
  });

  ipcMain.handle('dup:thumbnail', async (_, filePath) => {
    if (!filePath) return '';
    try {
      const img = await nativeImage.createThumbnailFromPath(filePath, { width: 96, height: 96 });
      return img ? img.toDataURL() : '';
    } catch (_) {
      return '';
    }
  });
};
