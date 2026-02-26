import { S } from './state.js';
import { el } from './elements.js';
import { fmt, barTier } from './format.js';
import { svgFolder, svgFile } from './icons.js';
// showCtx is imported lazily inside buildRow event listener to break circular dep
import { showCtx } from './contextMenu.js';

const ROW_H   = 26;       // must match --row-h in CSS
const BUFFER  = 15;       // extra rows rendered above/below viewport
const MAX_ROWS = 100_000; // safety cap for extremely large scans

// ── Virtual Scroller ──────────────────────────────────────────────────────────
export const VS = {
  _prevStart: -1,
  _prevEnd  : -1,

  update() {
    el.virtSpacer.style.height = (S.rows.length * ROW_H) + 'px';
    this._prevStart = -1;
    this.render();
  },

  render() {
    const total = S.rows.length;
    if (total === 0) { el.treeInner.innerHTML = ''; return; }

    const scrollTop = el.treeScroll.scrollTop;
    const viewH     = el.treeScroll.clientHeight;
    const startIdx  = Math.max(0,       Math.floor(scrollTop / ROW_H) - BUFFER);
    const endIdx    = Math.min(total-1, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

    if (startIdx === this._prevStart && endIdx === this._prevEnd) return;
    this._prevStart = startIdx;
    this._prevEnd   = endIdx;

    el.treeInner.style.top = (startIdx * ROW_H) + 'px';

    const frag = document.createDocumentFragment();
    for (let i = startIdx; i <= endIdx; i++) {
      frag.appendChild(buildRow(S.rows[i].node, S.rows[i].depth, i % 2 === 1));
    }
    el.treeInner.innerHTML = '';
    el.treeInner.appendChild(frag);
    syncSelection();
  },

  scrollToPath(p) {
    const idx = S.rows.findIndex(r => r.node.path === p);
    if (idx < 0) return;
    const scrollTop = el.treeScroll.scrollTop;
    const viewH     = el.treeScroll.clientHeight;
    const rowTop    = idx * ROW_H;
    const rowBottom = rowTop + ROW_H;
    if (rowTop < scrollTop)                 el.treeScroll.scrollTop = rowTop - 4;
    else if (rowBottom > scrollTop + viewH) el.treeScroll.scrollTop = rowBottom - viewH + 4;
  },
};

// Register scroll + resize listeners
export function initTree() {
  el.treeScroll.addEventListener('scroll', () => VS.render(), { passive: true });
  new ResizeObserver(() => VS.render()).observe(el.treeScroll);
}

// ── Flat row builder ──────────────────────────────────────────────────────────
export function rebuildRows() {
  const out = [];
  const visit = (node, depth) => {
    if (out.length >= MAX_ROWS) return;
    if (!S.settings.showHidden && node.name.startsWith('.') && depth > 0) return;
    out.push({ node, depth });
    if (node.isDir && node.children && S.expanded.has(node.path)) {
      for (const c of sortNodes(node.children)) visit(c, depth + 1);
    }
  };
  if (S.tree) visit(S.tree, 0);
  S.rows = out;
}

export function sortNodes(nodes) {
  const col = S.sortCol, dir = S.sortDir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (col === 'name') {
      const av = (a.name || '').toLowerCase(), bv = (b.name || '').toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    return ((a[col] || 0) - (b[col] || 0)) * dir;
  });
}

// ── Row builder ───────────────────────────────────────────────────────────────
export function buildRow(node, depth, isEven) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (isEven ? ' even' : '');
  row.dataset.path = node.path;

  // ── Name cell ─────────────────────────────────────────
  const nameCell = document.createElement('div');
  nameCell.className = 'row-name-cell';
  nameCell.style.paddingLeft = (depth * 20 + 6) + 'px';

  const toggle = document.createElement('div');
  toggle.className = 'row-toggle' + (node.isDir && node.children && node.children.length ? ' has-children' : '');
  if (node.isDir && node.children && node.children.length) {
    const expanded = S.expanded.has(node.path);
    toggle.innerHTML = expanded
      ? `<svg viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    toggle.addEventListener('click', e => { e.stopPropagation(); doToggle(node.path); });
  }
  nameCell.appendChild(toggle);

  const icon = document.createElement('div');
  icon.className = 'row-icon';
  icon.innerHTML = node.isDir ? svgFolder(S.expanded.has(node.path)) : svgFile(node.ext);
  nameCell.appendChild(icon);

  const nameEl = document.createElement('div');
  nameEl.className = 'row-name' + (node.error ? ' is-error' : '');
  nameEl.textContent = node.name;
  nameCell.appendChild(nameEl);
  row.appendChild(nameCell);

  // ── Size bar ───────────────────────────────────────────
  const parentSz = parentSize(node);
  const pct = parentSz > 0 ? (node.size / parentSz) * 100 : 0;

  const barCell = document.createElement('div');
  barCell.className = 'row-bar-cell';
  const track = document.createElement('div'); track.className = 'size-bar-track';
  const fill  = document.createElement('div');
  fill.className = 'size-bar-fill ' + barTier(pct);
  fill.style.width = Math.min(100, pct).toFixed(1) + '%';
  track.appendChild(fill);
  barCell.appendChild(track);
  const pctEl = document.createElement('span');
  pctEl.className = 'row-pct';
  pctEl.textContent = pct >= 0.05 ? (pct < 1 ? pct.toFixed(1) : pct.toFixed(0)) + '%' : '';
  barCell.appendChild(pctEl);
  row.appendChild(barCell);

  // ── Numeric cells ──────────────────────────────────────
  row.appendChild(mkCell('row-cell num row-size',    fmt(node.size)));
  row.appendChild(mkCell('row-cell num row-alloc',   fmt(node.allocated)));
  row.appendChild(mkCell('row-cell num row-files',   fmtN(node.files)));
  row.appendChild(mkCell('row-cell num row-folders', node.isDir ? fmtN(node.folders) : '—'));
  row.appendChild(mkCell('row-cell row-mtime',       fmtDate(node.mtime)));

  // ── Events ────────────────────────────────────────────
  row.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle this item in or out of the selection
      if (S.selectedSet.has(node.path)) {
        S.selectedSet.delete(node.path);
        if (S.selected === node.path)
          S.selected = S.selectedSet.size > 0 ? [...S.selectedSet].at(-1) : null;
      } else {
        S.selectedSet.add(node.path);
        S.selected = node.path;
        S.anchor   = node.path;
      }
    } else if (e.shiftKey && S.anchor) {
      // Range select from anchor to this row
      const ai = S.rows.findIndex(r => r.node.path === S.anchor);
      const ci = S.rows.findIndex(r => r.node.path === node.path);
      if (ai >= 0 && ci >= 0) {
        S.selectedSet.clear();
        const lo = Math.min(ai, ci), hi = Math.max(ai, ci);
        for (let i = lo; i <= hi; i++) S.selectedSet.add(S.rows[i].node.path);
      }
      S.selected = node.path;
      // anchor intentionally unchanged on shift-click
    } else {
      // Regular click — single select
      S.selectedSet.clear();
      S.selectedSet.add(node.path);
      S.selected = node.path;
      S.anchor   = node.path;
    }
    syncSelection();
    el.sbPath.textContent     = S.selected ?? '';
    el.btnDelete.disabled     = !S.selectedSet.size;
    el.btnShowFinder.disabled = !S.selected;
  });
  row.addEventListener('dblclick',    () => {
    if (node.isDir && node.children && node.children.length) doToggle(node.path);
    else window.dt.openItem(node.path);
  });
  row.addEventListener('contextmenu', e => showCtx(e, node));

  return row;
}

function mkCell(cls, text) {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text; return d;
}

// fmtN is duplicated locally to avoid an extra import inside buildRow
function fmtN(n) { return (n == null) ? '—' : n.toLocaleString(); }
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Expand / collapse ─────────────────────────────────────────────────────────
export function doToggle(p) {
  if (S.expanded.has(p)) {
    S.expanded.delete(p);
    for (const ep of [...S.expanded])
      if (ep.startsWith(p + '/') || ep.startsWith(p + '\\')) S.expanded.delete(ep);
  } else {
    S.expanded.add(p);
  }
  rebuildRows(); VS.update();
}

export function expandAll() {
  if (!S.tree) return;
  const depth = S.settings.expandDepth;
  const add = (node, d) => {
    if (!node.isDir || !node.children || d >= depth) return;
    S.expanded.add(node.path);
    for (const c of node.children) add(c, d + 1);
  };
  add(S.tree, 0);
  rebuildRows(); VS.update();
}

export function collapseAll() {
  if (!S.tree) return;
  S.expanded.clear();
  if (S.tree.isDir) S.expanded.add(S.tree.path);
  rebuildRows(); VS.update();
}

// ── Selection ─────────────────────────────────────────────────────────────────
export function selectPath(p) {
  S.selected = p;
  S.anchor   = p;
  S.selectedSet.clear();
  if (p) S.selectedSet.add(p);
  syncSelection();
  const node = S.rows.find(r => r.node.path === p)?.node;
  if (node) el.sbPath.textContent = node.path;
  el.btnDelete.disabled     = !p;
  el.btnShowFinder.disabled = !p;
}

export function syncSelection() {
  for (const r of el.treeInner.querySelectorAll('.tree-row.selected'))
    r.classList.remove('selected');
  for (const p of S.selectedSet) {
    const r = el.treeInner.querySelector(`.tree-row[data-path="${CSS.escape(p)}"]`);
    if (r) r.classList.add('selected');
  }
}

// ── Parent size (for bar %) ───────────────────────────────────────────────────
export function parentSize(node) {
  for (let i = 0; i < S.rows.length; i++) {
    if (S.rows[i].node === node) {
      const d = S.rows[i].depth;
      if (d === 0) return node.size;
      for (let j = i - 1; j >= 0; j--)
        if (S.rows[j].depth < d) return S.rows[j].node.size;
      break;
    }
  }
  return node.size;
}

// ── Keyboard navigation helpers ───────────────────────────────────────────────
export function navRows(dir, extend = false) {
  const rows = S.rows; if (!rows.length) return;
  let idx = rows.findIndex(r => r.node.path === S.selected);
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  const path = rows[idx].node.path;
  if (extend) {
    const ai = S.anchor ? rows.findIndex(r => r.node.path === S.anchor) : idx;
    const effectiveAi = ai >= 0 ? ai : idx;
    S.selectedSet.clear();
    const lo = Math.min(effectiveAi, idx), hi = Math.max(effectiveAi, idx);
    for (let i = lo; i <= hi; i++) S.selectedSet.add(rows[i].node.path);
    S.selected = path;
    syncSelection();
    el.sbPath.textContent     = path;
    el.btnDelete.disabled     = !S.selectedSet.size;
    el.btnShowFinder.disabled = !S.selected;
  } else {
    selectPath(path);
  }
  VS.scrollToPath(path);
}

export function expandSel() {
  const n = S.rows.find(r => r.node.path === S.selected)?.node;
  if (!n || !n.isDir) return;
  if (!S.expanded.has(n.path)) doToggle(n.path);
  else navRows(1);
}

export function collapseSel() {
  const rows = S.rows;
  const idx  = rows.findIndex(r => r.node.path === S.selected);
  if (idx < 0) return;
  const n = rows[idx].node;
  if (n.isDir && S.expanded.has(n.path)) { doToggle(n.path); return; }
  if (idx > 0 && rows[idx].depth > 0) {
    const d = rows[idx].depth;
    for (let j = idx - 1; j >= 0; j--) {
      if (rows[j].depth < d) { selectPath(rows[j].node.path); VS.scrollToPath(rows[j].node.path); break; }
    }
  }
}
