'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { ipcMain, nativeImage } = require('electron');
const { stateFor, existingState } = require('../senderState');
const { CHUNK_SIZE, packItems } = require('../treeTransfer');

// A duplicate search lives in the calling window's state (senderState.dup), so no IPC message
// carries all paths or all result groups: candidates arrive in chunks (dup:addCandidates) and the
// result groups are pulled in chunks (dup:resultChunk).
//   dup = { id, phase: 'upload' | 'running' | 'done', ctrl, sizes, chunks }
let dupCounter = 0;

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

async function findDuplicatesInternal(multiFileGroups, sender, ctrl) {
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
      if (doneFiles % 10 === 0 && sender && !ctrl.cancelled) { // a cancelled run must not move a newer run's bar
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

  return resultGroups;
}

// The caller's state, if it holds run `id` in the given phase.
function ownRun(event, id, phase) {
  const st = existingState(event.sender);
  return st && st.dup && st.dup.id === id && st.dup.phase === phase ? st : null;
}

function registerDuplicatesIpc() {
  ipcMain.handle('dup:begin', (event) => {
    const st = stateFor(event.sender);
    if (st.dup) st.dup.ctrl.cancelled = true;
    const id = `dup-${++dupCounter}`;
    st.dup = { id, phase: 'upload', ctrl: { cancelled: false }, sizes: new Map(), chunks: null };
    return { ok: true, id };
  });

  ipcMain.handle('dup:addCandidates', (event, id, groups) => {
    const st = ownRun(event, id, 'upload');
    if (!st) return { ok: false, error: 'Unknown run' };
    const valid = Array.isArray(groups) && groups.length > 0 &&
      groups.every(g => g && Number.isFinite(g.size) && Array.isArray(g.paths) &&
        g.paths.length > 0 && g.paths.every(p => typeof p === 'string')) &&
      groups.reduce((n, g) => n + g.paths.length, 0) <= CHUNK_SIZE;
    if (!valid) {
      st.dup = null;
      return { ok: false, error: 'Invalid chunk' };
    }
    for (const g of groups) {
      const known = st.dup.sizes.get(g.size);
      if (known) known.push(...g.paths);
      else st.dup.sizes.set(g.size, [...g.paths]);
    }
    return { ok: true };
  });

  ipcMain.handle('dup:run', async (event, id) => {
    const st = ownRun(event, id, 'upload');
    if (!st) return { ok: false, error: 'Unknown run' };
    const dup = st.dup;
    dup.phase = 'running';
    const candidates = Array.from(dup.sizes, ([size, paths]) => ({ size, paths }));
    dup.sizes = null;
    const groups = await findDuplicatesInternal(candidates, event.sender, dup.ctrl);
    if (dup.ctrl.cancelled) {
      if (st.dup === dup) st.dup = null; // not when a newer run replaced it
      return { ok: false, cancelled: true };
    }
    dup.chunks = packItems(groups, 'files');
    dup.phase = 'done';
    return { ok: true, cancelled: false, groupCount: groups.length, chunkCount: dup.chunks.length };
  });

  ipcMain.handle('dup:resultChunk', (event, id, index) => {
    const st = ownRun(event, id, 'done');
    if (!st) return { ok: false, error: 'Result is no longer available' };
    const chunk = Number.isInteger(index) ? st.dup.chunks[index] : undefined;
    if (!chunk) return { ok: false, error: 'Invalid chunk index' };
    return { ok: true, groups: chunk };
  });

  ipcMain.handle('dup:release', (event, id) => {
    const st = existingState(event.sender);
    if (!st || !st.dup || st.dup.id !== id) return;
    st.dup.ctrl.cancelled = true; // also stops a run that is still hashing
    st.dup = null;
  });

  ipcMain.handle('dup:cancel', (event) => {
    const st = existingState(event.sender);
    if (st && st.dup) st.dup.ctrl.cancelled = true;
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
}

module.exports = registerDuplicatesIpc;
