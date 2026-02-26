import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _root   = null;   // node currently displayed as treemap root
let _crumbs = [];     // breadcrumb stack of nodes

// ── Zoom / Pan state ──────────────────────────────────────────────────────────
let _zoom      = { scale: 1, tx: 0, ty: 0 };
let _isPanning = false;
let _panStart  = { x: 0, y: 0, tx: 0, ty: 0 };
let _zoomBtn   = null;  // lazily created reset button

const MIN_SCALE = 0.5;
const MAX_SCALE = 12;

// ── Public API ────────────────────────────────────────────────────────────────
export function setupTreemap() {
  new ResizeObserver(() => {
    if (el.chartWrap.style.display !== 'none') {
      _resetZoom(false);
      _render();
    }
  }).observe(el.treemapContainer);

  _setupZoom();
}

export function initTreemap() {
  _root   = null;
  _crumbs = [];
  _resetZoom(false);
}

export function renderTreemap() {
  if (!S.tree) return;
  if (!_root) _drillTo(S.tree);
  else        _render();
}

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function _resetZoom(render = true) {
  _zoom = { scale: 1, tx: 0, ty: 0 };
  _applyZoom();
  if (render) _render();
}

function _applyZoom() {
  const svg = el.treemapContainer.querySelector('svg');
  if (svg) {
    svg.style.transform       = `translate(${_zoom.tx}px, ${_zoom.ty}px) scale(${_zoom.scale})`;
    svg.style.transformOrigin = '0 0';
  }
  _updateZoomBtn();
}

function _updateZoomBtn() {
  if (!_zoomBtn) return;
  const zoomed = Math.abs(_zoom.scale - 1) > 0.02 || _zoom.tx !== 0 || _zoom.ty !== 0;
  _zoomBtn.style.display = zoomed ? 'flex' : 'none';
  if (zoomed) _zoomBtn.textContent = `${_zoom.scale.toFixed(1)}×  Reset`;
}

function _setupZoom() {
  const c = el.treemapContainer;

  // Mouse wheel zoom – zooms toward cursor position
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const rect     = c.getBoundingClientRect();
    const mx       = e.clientX - rect.left;
    const my       = e.clientY - rect.top;
    const factor   = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, _zoom.scale * factor));
    _zoom.tx    = mx - (mx - _zoom.tx) * (newScale / _zoom.scale);
    _zoom.ty    = my - (my - _zoom.ty) * (newScale / _zoom.scale);
    _zoom.scale = newScale;
    _applyZoom();
  }, { passive: false });

  // Drag to pan (always available; at 1× it feels like browsing)
  c.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _isPanning = false; // reset; mousemove will confirm if actual drag
    _panStart  = { x: e.clientX, y: e.clientY, tx: _zoom.tx, ty: _zoom.ty };
  });

  document.addEventListener('mousemove', e => {
    if (!_panStart || e.buttons !== 1) return;
    const dx = e.clientX - _panStart.x;
    const dy = e.clientY - _panStart.y;
    if (!_isPanning && Math.hypot(dx, dy) < 4) return; // ignore tiny jitter
    _isPanning = true;
    _zoom.tx = _panStart.tx + dx;
    _zoom.ty = _panStart.ty + dy;
    el.treemapContainer.style.cursor = 'grabbing';
    _applyZoom();
  });

  document.addEventListener('mouseup', () => {
    if (_isPanning) {
      _isPanning = false;
      el.treemapContainer.style.cursor = '';
    }
    _panStart = null;
  });

  // Double-click empty area to reset zoom
  c.addEventListener('dblclick', e => {
    if (!e.target.closest('.tm-cell')) _resetZoom();
  });
}

// ── Drill-down helpers ────────────────────────────────────────────────────────
function _drillTo(node) {
  _resetZoom(false);
  _crumbs.push(node);
  _root = node;
  _render();
  _buildBreadcrumb();
}

function _crumbTo(idx) {
  _resetZoom(false);
  _crumbs = _crumbs.slice(0, idx + 1);
  _root   = _crumbs[_crumbs.length - 1];
  _render();
  _buildBreadcrumb();
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
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

  // Re-create zoom reset button (cleared by innerHTML above)
  _zoomBtn = document.createElement('button');
  _zoomBtn.className = 'tm-zoom-reset';
  _zoomBtn.title     = 'Reset zoom  (or double-click map)';
  _zoomBtn.addEventListener('click', () => _resetZoom());
  container.appendChild(_zoomBtn);
  _updateZoomBtn();

  const { width, height } = container.getBoundingClientRect();
  if (!_root || width < 4 || height < 4) return;

  const children = (_root.children || []).filter(n => n.size > 0);
  if (!children.length) {
    const msg = document.createElement('div');
    msg.className   = 'tm-empty';
    msg.textContent = 'No items to display';
    container.appendChild(msg);
    return;
  }

  const totalSize = children.reduce((s, n) => s + n.size, 0);
  const totalArea = width * height;

  const items = children
    .sort((a, b) => b.size - a.size)
    .map(n => ({ node: n, area: (n.size / totalSize) * totalArea }));

  const cells = [];
  _squarify(items, 0, 0, width, height, cells);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width',  width);
  svg.setAttribute('height', height);

  // Preserve current zoom across re-renders
  svg.style.transform       = `translate(${_zoom.tx}px, ${_zoom.ty}px) scale(${_zoom.scale})`;
  svg.style.transformOrigin = '0 0';

  // Gradient defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _addGrad(defs, 'tm-g1', '#ef4444', '#f97316');
  _addGrad(defs, 'tm-g2', '#f59e0b', '#fbbf24');
  _addGrad(defs, 'tm-g3', '#3b82f6', '#60a5fa');
  _addGrad(defs, 'tm-g4', '#10b981', '#34d399');
  svg.appendChild(defs);

  for (const cell of cells) {
    const { node, x, y, w, h } = cell;
    const pct  = (node.size / totalSize) * 100;
    const tier = pct >= 50 ? 1 : pct >= 20 ? 2 : pct >= 5 ? 3 : 4;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('tm-cell', `tm-t${tier}`);
    if (!node.isDir) g.classList.add('is-file');

    const GAP  = 1.5;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',      x + GAP);
    rect.setAttribute('y',      y + GAP);
    rect.setAttribute('width',  Math.max(0, w - GAP * 2));
    rect.setAttribute('height', Math.max(0, h - GAP * 2));
    rect.setAttribute('rx', 4);
    rect.setAttribute('fill', `url(#tm-g${tier})`);
    g.appendChild(rect);

    const cx = x + w / 2, cy = y + h / 2;
    const showName = w > 52 && h > 26;
    const showSize = w > 60 && h > 46;

    if (showName) {
      const nameEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameEl.classList.add('tm-name');
      nameEl.setAttribute('x', cx);
      nameEl.setAttribute('y', showSize ? cy - 9 : cy);
      nameEl.textContent = _truncate(node.name, w, 12.5);
      g.appendChild(nameEl);
    }
    if (showSize) {
      const sizeEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sizeEl.classList.add('tm-size');
      sizeEl.setAttribute('x', cx);
      sizeEl.setAttribute('y', cy + 10);
      sizeEl.textContent = fmt(node.size);
      g.appendChild(sizeEl);
    }

    if (node.isDir && node.children && node.children.length) {
      g.addEventListener('click', e => {
        if (_isPanning) return; // suppress click if user was panning
        _drillTo(node);
        e.stopPropagation();
      });
    }

    svg.appendChild(g);
  }

  container.appendChild(svg);
}

// ── Squarify layout (Bruls, Huizing, van Wijk) ────────────────────────────────
function _squarify(items, x, y, w, h, result) {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ node: items[0].node, x, y, w, h });
    return;
  }

  let row       = [];
  let remaining = [...items];
  let rx = x, ry = y, rw = w, rh = h;

  while (remaining.length > 0) {
    const isWide = rw >= rh;
    const side   = isWide ? rh : rw;
    const newRow = [...row, remaining[0]];

    if (row.length === 0 || _worst(newRow, side) <= _worst(row, side)) {
      row = newRow;
      remaining.shift();
    } else {
      const rowArea = row.reduce((s, i) => s + i.area, 0);
      if (isWide) {
        const rowW = rw > 0 ? rowArea / rh : 0;
        _layoutRow(row, rx, ry, rowW, rh, false, result);
        rx += rowW; rw -= rowW;
      } else {
        const rowH = rh > 0 ? rowArea / rw : 0;
        _layoutRow(row, rx, ry, rw, rowH, true, result);
        ry += rowH; rh -= rowH;
      }
      row = [];
    }
  }

  if (row.length > 0) {
    const isWide  = rw >= rh;
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    if (isWide) {
      const rowW = rh > 0 ? Math.min(rowArea / rh, rw) : rw;
      _layoutRow(row, rx, ry, rowW, rh, false, result);
    } else {
      const rowH = rw > 0 ? Math.min(rowArea / rw, rh) : rh;
      _layoutRow(row, rx, ry, rw, rowH, true, result);
    }
  }
}

function _worst(row, side) {
  if (!row.length || side <= 0) return Infinity;
  const total = row.reduce((s, i) => s + i.area, 0);
  const len   = total / side;
  if (len <= 0) return Infinity;
  return row.reduce((w, i) => {
    const s = i.area / len;
    return Math.max(w, Math.max(len / s, s / len));
  }, 0);
}

function _layoutRow(row, x, y, w, h, isHorizontal, result) {
  const rowArea = row.reduce((s, i) => s + i.area, 0);
  let pos = isHorizontal ? y : x;
  for (const item of row) {
    const frac = rowArea > 0 ? item.area / rowArea : 1 / row.length;
    if (isHorizontal) {
      result.push({ node: item.node, x, y: pos, w, h: h * frac });
      pos += h * frac;
    } else {
      result.push({ node: item.node, x: pos, y, w: w * frac, h });
      pos += w * frac;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _addGrad(defs, id, c1, c2) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  g.id = id;
  g.setAttribute('x1', '0'); g.setAttribute('y1', '0');
  g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
  g.setAttribute('gradientUnits', 'objectBoundingBox');
  const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', c1);
  const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', c2);
  g.appendChild(s1); g.appendChild(s2);
  defs.appendChild(g);
}

function _truncate(text, cellW, fontSize) {
  const maxChars = Math.max(3, Math.floor((cellW - 16) / (fontSize * 0.6)));
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…';
}
