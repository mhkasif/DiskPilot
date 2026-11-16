import { S } from './state.js';
import { rebuildRows, VS, selectPath } from './tree.js';
import { showCtx } from './contextMenu.js';

// Shared navigation for the chart views (treemap, bar chart, pie chart).
// The current folder is one path string (S.viewPath), resolved against S.tree on every render,
// so it survives view switches and rescans without holding on to stale node objects.

const SEPS = ['/', '\\'];
const isInside = (path, dirPath) => path === dirPath || SEPS.some(s => path.startsWith(dirPath + s));

// Chain of folder nodes from `root` down to `path`. If `path` (or a part of it) does not exist,
// the chain ends at the nearest existing ancestor; with no usable path it is just [root].
export function pathChain(root, path) {
  if (!root) return [];
  const chain = [root];
  if (typeof path !== 'string') return chain;
  let node = root;
  while (node.path !== path) {
    const next = (node.children || []).find(c => c.isDir && isInside(path, c.path));
    if (!next) break;
    chain.push(next);
    node = next;
  }
  return chain;
}

export function resolveChain() {
  return pathChain(S.tree, S.viewPath);
}

export function setViewPath(p) {
  S.viewPath = p;
}

// A scan of a different root starts at that root; a rescan of the same root keeps the folder.
export function startScanView(newRoot) {
  if (newRoot !== S.rootPath) S.viewPath = null;
}

// Breadcrumb for `chain` inside `container`. File names only ever go in through textContent.
export function buildBreadcrumb(container, chain, onPick) {
  container.innerHTML = '';
  chain.forEach((node, i) => {
    const span = document.createElement('span');
    span.textContent = (i === 0 && !node.name) ? node.path : node.name;
    if (i < chain.length - 1) {
      span.className = 'crumb';
      span.addEventListener('click', () => onPick(node));
    } else {
      span.className = 'crumb current';
    }
    container.appendChild(span);
    if (i < chain.length - 1) {
      const sep = document.createElement('span');
      sep.className   = 'crumb-sep';
      sep.textContent = ' ›';
      container.appendChild(sep);
    }
  });
}

// Context menu on a chart item: same menu as the tree, but without Delete (charts do not
// re-render after a delete). Items without a path (the pie's "Other" slice) get no menu.
export function chartContextMenu(e, node) {
  if (!node || !node.path) return;
  showCtx(e, node, { hideDelete: true });
}

// Leaving a chart for the tree: expand the ancestors of the current folder, select it, scroll to it.
export function revealViewPath() {
  if (S.viewPath == null) return;
  const chain = resolveChain();
  if (!chain.length) return;
  for (const n of chain.slice(0, -1)) S.expanded.add(n.path);
  const target = chain[chain.length - 1].path;
  rebuildRows();
  VS.update();
  selectPath(target);
  VS.scrollToPath(target);
}
