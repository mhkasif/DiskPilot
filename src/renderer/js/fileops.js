import { S } from './state.js';
import { el } from './elements.js';
import { rebuildRows, VS } from './tree.js';
import { updateStatusBar, flashStatus } from './statusBar.js';

// ── Delete progress overlay ──────────────────────────────────────────────
const delOverlay = () => document.getElementById('delete-overlay');

function showDeleteOverlay(total) {
  const overlay = delOverlay();
  if (!overlay) return;
  const title   = document.getElementById('delete-title');
  const detail  = document.getElementById('delete-detail');
  const bar     = document.getElementById('delete-progress-bar');
  const percent = document.getElementById('delete-percent');
  const spinner = document.getElementById('delete-spinner');
  if (title)   title.textContent   = total === 1 ? 'Deleting 1 item…' : `Deleting ${total} items…`;
  if (detail)  detail.textContent  = 'Preparing…';
  if (bar)     bar.style.width     = '0%';
  if (percent) percent.textContent = `0 / ${total}`;
  if (spinner) spinner.classList.remove('done');
  overlay.style.display = 'flex';
}

function hideDeleteOverlay() {
  const overlay = delOverlay();
  if (overlay) overlay.style.display = 'none';
}

// Register the progress + cancel listeners once
export function setupDeleteProgress() {
  window.dt.onDeleteProgress?.((d) => {
    const overlay = delOverlay();
    if (!overlay) return;
    const total = d.total || 1;
    if (d.current < total && overlay.style.display === 'none') {
      showDeleteOverlay(total);
    }
    const detail  = document.getElementById('delete-detail');
    const bar     = document.getElementById('delete-progress-bar');
    const percent = document.getElementById('delete-percent');
    const pct     = Math.min(100, Math.round((d.current / total) * 100));
    if (bar)     bar.style.width     = pct + '%';
    if (percent) percent.textContent = `${d.current} / ${total}`;
    if (detail)  detail.textContent  = d.path || `${d.deleted} deleted${d.failed ? `, ${d.failed} failed` : ''}`;
  });

  const cancelBtn = document.getElementById('delete-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelBtn.disabled = true;
      const detail = document.getElementById('delete-detail');
      if (detail) detail.textContent = 'Cancelling…';
      window.dt.cancelDelete?.();
    });
  }
}

export async function deleteSelected() {
  const paths = [...S.selectedSet];
  if (!paths.length) return;

  // ── Show loading state ──────────────────────────────────────────────────
  el.btnDelete.disabled = true;
  el.btnDelete.classList.add('deleting');
  flashStatus('Deleting…');

  const cancelBtn = document.getElementById('delete-cancel-btn');
  if (cancelBtn) cancelBtn.disabled = false;

  let lastError = null;
  let res;
  try {
    res = await window.dt.deleteItems(paths);
  } finally {
    hideDeleteOverlay();
  }

  if (res.cancelled && !(res.deletedPaths || []).length) {
    el.btnDelete.classList.remove('deleting');
    el.btnDelete.disabled = false;
    flashStatus('Delete cancelled.');
    return;
  }
  for (const p of res.deletedPaths || []) removeFromTree(p);
  if (res.errors?.length) lastError = res.errors.map(e => e.error).join('; ');
  const deletedCount = (res.deletedPaths || []).length;

  // ── Clear selection & refresh list ──────────────────────────────────────
  S.selectedSet.clear();
  S.selected = null;
  S.anchor   = null;
  el.btnDelete.classList.remove('deleting');
  el.btnDelete.disabled     = true;
  el.btnShowFinder.disabled = true;
  el.sbPath.textContent     = '';

  rebuildRows();
  VS.update();

  // ── Status feedback ────────────────────────────────────────────────────
  if (lastError) {
    flashStatus('Delete failed: ' + lastError, true);
  } else if (res.cancelled && deletedCount > 0) {
    const label = deletedCount === 1 ? '1 item' : `${deletedCount} items`;
    flashStatus(`Cancelled — ${label} deleted`);
  } else if (deletedCount > 0) {
    const label = deletedCount === 1 ? '1 item' : `${deletedCount} items`;
    flashStatus(`${label} deleted ✓`);
  }
  if (S.tree) updateStatusBar('Scan complete', S.rootPath, S.tree.size, S.tree.files, S.tree.folders);
}

export function removeFromTree(p, node = S.tree) {
  if (!node || !node.children) return false;
  const idx = node.children.findIndex(c => c.path === p);
  if (idx !== -1) {
    const rm = node.children[idx];
    node.size      -= rm.size;
    node.allocated -= rm.allocated;
    node.files     -= rm.files;
    if (rm.isDir) node.folders -= 1 + rm.folders;
    node.children.splice(idx, 1);
    return true;
  }
  for (const c of node.children) if (removeFromTree(p, c)) return true;
  return false;
}
