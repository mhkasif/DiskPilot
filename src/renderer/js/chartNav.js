import { S } from './state.js';
import { rebuildRows, VS, selectPath } from './tree.js';
import { showCtx, hideCtx } from './contextMenu.js';

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
    const dirs  = (node.children || []).filter(c => c.isDir);
    // An exact path match wins; otherwise the longest separator-prefix match (a POSIX folder
    // named "b\\c" must not be read as folder "c" inside "b").
    const next  = dirs.find(c => c.path === path)
      || dirs.filter(c => isInside(path, c.path)).sort((a, b) => b.path.length - a.path.length)[0];
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
// The menu keeps its own target and never touches the tree selection: a chart can go stale
// after a delete, so the tree's Delete key / button must not see this node.
export function chartContextMenu(e, node) {
  if (!node || !node.path) {
    e.preventDefault(); e.stopPropagation();   // no browser menu, and no stale chart menu left open
    hideCtx();
    return;
  }
  showCtx(e, node, { hideDelete: true, target: node });
}

export const CHART_VIEWS = ['treemap', 'barchart', 'piechart'];
export const isChartView = () => CHART_VIEWS.includes(S.currentView);

// Leaving a chart for the tree: expand the ancestors of the current folder, select the deepest
// of them that has a visible row, and scroll to it. The folder itself is not expanded.
// Left unchanged: no view path yet, or the folder is the scan root (nothing to reveal). If the
// folder has no row (hidden dot-folder with showHidden off, or filtered out) the nearest ancestor
// with a row is used; if that is only the scan root, or nothing, the selection stays as it was.
export function revealViewPath() {
  if (S.viewPath == null) return;
  const chain = resolveChain();
  if (chain.length < 2) return;
  for (const n of chain.slice(0, -1)) S.expanded.add(n.path);
  rebuildRows();
  VS.update();
  for (let i = chain.length - 1; i >= 1; i--) {
    const p = chain[i].path;
    if (!S.rows.some(r => r.node.path === p)) continue;
    selectPath(p);
    VS.scrollToPath(p);
    return;
  }
}
