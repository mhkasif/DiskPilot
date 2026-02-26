import { S } from './state.js';
import { el } from './elements.js';
import { rebuildRows, VS } from './tree.js';
import { updateStatusBar, flashStatus } from './statusBar.js';

export async function deleteSelected() {
  const paths = [...S.selectedSet];
  if (!paths.length) return;

  let lastError   = null;
  let deletedCount = 0;
  for (const p of paths) {
    const res = await window.dt.deleteItem(p);
    if (!res.ok) {
      if (!res.cancelled && res.error) lastError = res.error;
      continue;
    }
    removeFromTree(p);
    deletedCount++;
  }

  S.selectedSet.clear();
  S.selected = null;
  S.anchor   = null;
  el.btnDelete.disabled     = true;
  el.btnShowFinder.disabled = true;
  el.sbPath.textContent     = '';
  rebuildRows(); VS.update();

  if (lastError) {
    flashStatus('Delete failed: ' + lastError, true);
  } else {
    const label = deletedCount === 1 ? '1 item' : `${deletedCount} items`;
    flashStatus(`${label} moved to Trash ✓`);
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
