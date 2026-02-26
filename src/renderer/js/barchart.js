import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _root   = null;
let _crumbs = [];

// ── Public API ────────────────────────────────────────────────────────────────
export function setupBarchart() {
  new ResizeObserver(() => {
    if (el.chartWrap.style.display !== 'none' && S.currentView === 'barchart') _render();
  }).observe(el.treemapContainer);
}

export function initBarchart() {
  _root   = null;
  _crumbs = [];
}

export function renderBarchart() {
  if (!S.tree) return;
  if (!_root) _drillTo(S.tree);
  else        _render();
}

// ── Navigation ────────────────────────────────────────────────────────────────
function _drillTo(node) {
  _crumbs.push(node);
  _root = node;
  _render();
  _buildBreadcrumb();
}

function _crumbTo(idx) {
  _crumbs = _crumbs.slice(0, idx + 1);
  _root   = _crumbs[_crumbs.length - 1];
  _render();
  _buildBreadcrumb();
}

function _buildBreadcrumb() {
  el.chartBreadcrumb.innerHTML = '';
  _crumbs.forEach((node, i) => {
    const span  = document.createElement('span');
    const label = (i === 0 && !node.name) ? node.path : node.name;
    span.textContent = label;
    if (i < _crumbs.length - 1) {
      span.className = 'crumb';
      span.addEventListener('click', () => _crumbTo(i));
    } else {
      span.className = 'crumb current';
    }
    el.chartBreadcrumb.appendChild(span);
    if (i < _crumbs.length - 1) {
      const sep = document.createElement('span');
      sep.className   = 'crumb-sep';
      sep.textContent = ' ›';
      el.chartBreadcrumb.appendChild(sep);
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function _render() {
  const container = el.treemapContainer;
  container.innerHTML = '';
  if (!_root) return;

  const children = (_root.children || [])
    .filter(n => n.size > 0)
    .sort((a, b) => b.size - a.size);

  if (!children.length) {
    const msg = document.createElement('div');
    msg.className   = 'tm-empty';
    msg.textContent = 'No items to display';
    container.appendChild(msg);
    return;
  }

  const totalSize = children.reduce((s, n) => s + n.size, 0);
  const maxSize   = children[0].size;

  const wrap = document.createElement('div');
  wrap.className = 'bc-wrap';

  for (const node of children) {
    const pct    = (node.size / totalSize) * 100;
    const barPct = (node.size / maxSize)   * 100;
    const tier   = pct >= 50 ? 1 : pct >= 20 ? 2 : pct >= 5 ? 3 : 4;
    const canDrill = node.isDir && node.children && node.children.length;

    const row = document.createElement('div');
    row.className = canDrill ? 'bc-row bc-dir' : 'bc-row';

    // Icon + Name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'bc-name';
    const iconSpan = document.createElement('span');
    iconSpan.className = `bc-icon bc-t${tier}`;
    iconSpan.innerHTML = node.isDir
      ? '<svg viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15v9H1z" fill="currentColor" opacity=".8"/></svg>'
      : '<svg viewBox="0 0 16 16"><path d="M3 2h7l3 3v9H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 2v3h3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
    const nameSpan = document.createElement('span');
    nameSpan.className   = 'bc-label';
    nameSpan.textContent = node.name || node.path;
    nameDiv.appendChild(iconSpan);
    nameDiv.appendChild(nameSpan);

    // Bar
    const barDiv   = document.createElement('div');
    barDiv.className = 'bc-bar-cell';
    const track    = document.createElement('div');
    track.className = 'bc-track';
    const fill     = document.createElement('div');
    fill.className = `bc-fill bc-fill-t${tier}`;
    fill.style.width = barPct.toFixed(1) + '%';
    track.appendChild(fill);
    barDiv.appendChild(track);

    // Size
    const sizeDiv = document.createElement('div');
    sizeDiv.className   = 'bc-size';
    sizeDiv.textContent = fmt(node.size);

    // Pct
    const pctDiv = document.createElement('div');
    pctDiv.className   = 'bc-pct';
    pctDiv.textContent = pct < 0.1 ? '<0.1%' : pct.toFixed(1) + '%';

    row.appendChild(nameDiv);
    row.appendChild(barDiv);
    row.appendChild(sizeDiv);
    row.appendChild(pctDiv);

    if (canDrill) row.addEventListener('click', () => _drillTo(node));
    wrap.appendChild(row);
  }

  container.appendChild(wrap);
}
