import { S, findNode } from './state.js';
import { el } from './elements.js';
import { selectPath } from './tree.js';
import { deleteSelected } from './fileops.js';
import { flashStatus } from './statusBar.js';

// opts.hideDelete: chart views hide the Delete item (and its separator) because charts do not
// re-render after a delete. Every call sets the state, so the tree view gets Delete back.
export function showCtx(e, node, opts = {}) {
  e.preventDefault(); e.stopPropagation();
  for (const n of el.ctxMenu.querySelectorAll('[data-hide-in-chart]')) {
    n.style.display = opts.hideDelete ? 'none' : '';
  }
  // If right-clicking outside the current selection, reset to just this item
  if (!S.selectedSet.has(node.path)) {
    selectPath(node.path);
  } else {
    S.selected = node.path; // promote as primary without clearing set
  }
  el.ctxMenu.style.display = 'block';
  let x = e.clientX, y = e.clientY;
  el.ctxMenu.style.left = x + 'px';
  el.ctxMenu.style.top  = y + 'px';
  const r = el.ctxMenu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  el.ctxMenu.style.left = (x - r.width)  + 'px';
  if (r.bottom > window.innerHeight) el.ctxMenu.style.top  = (y - r.height) + 'px';
}

export function hideCtx() { el.ctxMenu.style.display = 'none'; }

export function setupContextMenu() {
  document.addEventListener('click', hideCtx);
  el.ctxMenu.addEventListener('click', async e => {
    const item = e.target.closest('.ctx-item'); if (!item) return;
    const action = item.dataset.action;
    const node   = findNode(S.selected || '');
    hideCtx();
    if (!node) return;
    switch (action) {
      case 'open'      : window.dt.openItem(node.path); break;
      case 'showInDir' : window.dt.showInDir(node.path); break;
      case 'copyPath'  : window.dt.copyPath(node.path); flashStatus('Path copied to clipboard'); break;
      case 'delete'    : deleteSelected(); break;
    }
  });
}
