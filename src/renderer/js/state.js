// ── App state ─────────────────────────────────────────────────────────────────
export const S = {
  tree       : null,
  rows       : [],      // flat array of {node, depth} for every visible row
  expanded   : new Set(),
  selected   : null,    // primary / last-clicked path
  selectedSet: new Set(), // all selected paths (multi-select)
  anchor     : null,    // anchor for shift-range selection
  sortCol    : 'size',
  sortDir    : 'desc',
  unitMode   : 'auto',
  scanning   : false,
  scanId     : null,
  scanStart  : 0,
  rootPath   : null,
  settings   : {
    theme      : 'auto',  // 'auto' | 'light' | 'dark'
    units      : 'auto',
    expandDepth: 3,
    showHidden : false,
  },
};

// ── Tree search ───────────────────────────────────────────────────────────────
export function findNode(p, node = S.tree) {
  if (!node) return null;
  if (node.path === p) return node;
  if (node.children) {
    for (const c of node.children) {
      const f = findNode(p, c);
      if (f) return f;
    }
  }
  return null;
}
