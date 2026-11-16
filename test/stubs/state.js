// Test stub for src/renderer/js/state.js
export const S = {
  tree: null, rootPath: '', selected: null, selectedSet: new Set(), anchor: null,
  expanded: new Set(), scanning: false, scanStart: 0, scanId: null, currentView: 'tree', viewPath: null,
  rows: [], settings: { showHidden: false }, sortCol: 'size', sortDir: 'desc', filter: null,
};
// Same lookup as the real state.js (kept faithful: menu actions resolve their node through it).
export function findNode(p, node = S.tree) {
  if (!node) return null;
  if (node.path === p) return node;
  for (const c of node.children || []) { const f = findNode(p, c); if (f) return f; }
  return null;
}
