import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _root   = null;
let _crumbs = [];

const COLORS = [
  ['#ef4444', '#f97316'],
  ['#3b82f6', '#60a5fa'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#8b5cf6', '#a78bfa'],
  ['#ec4899', '#f472b6'],
  ['#06b6d4', '#22d3ee'],
  ['#84cc16', '#a3e635'],
];

// ── Public API ────────────────────────────────────────────────────────────────
export function setupPiechart() {
  new ResizeObserver(() => {
    if (el.chartWrap.style.display !== 'none' && S.currentView === 'piechart') _render();
  }).observe(el.treemapContainer);
}

export function initPiechart() {
  _root   = null;
  _crumbs = [];
}

export function renderPiechart() {
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

  const all = (_root.children || []).filter(n => n.size > 0).sort((a, b) => b.size - a.size);
  if (!all.length) {
    const msg = document.createElement('div');
    msg.className   = 'tm-empty';
    msg.textContent = 'No items to display';
    container.appendChild(msg);
    return;
  }

  const MAX_SEGS  = 8;
  const segs      = all.slice(0, MAX_SEGS);
  const otherSize = all.slice(MAX_SEGS).reduce((s, n) => s + n.size, 0);
  if (otherSize > 0) segs.push({ name: 'Other', size: otherSize, isOther: true });

  const total = segs.reduce((s, n) => s + n.size, 0);

  // ── SVG donut ────────────────────────────────────────────────────────────
  const { width, height } = container.getBoundingClientRect();
  const svgSize = Math.max(180, Math.min(width * 0.44, height - 40, 360));
  const cx = svgSize / 2, cy = svgSize / 2;
  const outerR = svgSize * 0.42;
  const innerR = outerR * 0.54;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width',  svgSize);
  svg.setAttribute('height', svgSize);
  svg.style.flexShrink = '0';

  // Gradient defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  segs.forEach((seg, i) => {
    const [c1, c2] = seg.isOther ? ['#6b7280', '#9ca3af'] : COLORS[i % COLORS.length];
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    g.id = `pc-g${i}`;
    g.setAttribute('x1', '0'); g.setAttribute('y1', '0');
    g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
    g.setAttribute('gradientUnits', 'objectBoundingBox');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', c1);
    const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', c2);
    g.appendChild(s1); g.appendChild(s2);
    defs.appendChild(g);
  });
  svg.appendChild(defs);

  // Draw sectors
  let startAngle = -Math.PI / 2;
  segs.forEach((seg, i) => {
    const angle    = (seg.size / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;

    const x1  = cx + outerR * Math.cos(startAngle);
    const y1  = cy + outerR * Math.sin(startAngle);
    const x2  = cx + outerR * Math.cos(endAngle);
    const y2  = cy + outerR * Math.sin(endAngle);
    const xi1 = cx + innerR * Math.cos(endAngle);
    const yi1 = cy + innerR * Math.sin(endAngle);
    const xi2 = cx + innerR * Math.cos(startAngle);
    const yi2 = cy + innerR * Math.sin(startAngle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi2} ${yi2}`,
      'Z',
    ].join(' '));
    path.setAttribute('fill',         `url(#pc-g${i})`);
    path.setAttribute('stroke',       'var(--bg)');
    path.setAttribute('stroke-width', '2');
    path.style.transition = 'opacity .15s, transform .15s';
    path.style.transformOrigin = `${cx}px ${cy}px`;

    const canDrill = !seg.isOther && seg.isDir && seg.children && seg.children.length;
    if (canDrill) {
      path.style.cursor = 'pointer';
      path.addEventListener('mouseenter', () => { path.style.transform = 'scale(1.04)'; });
      path.addEventListener('mouseleave', () => { path.style.transform = ''; });
      path.addEventListener('click', () => _drillTo(seg));
    } else {
      path.addEventListener('mouseenter', () => { path.style.opacity = '0.8'; });
      path.addEventListener('mouseleave', () => { path.style.opacity = '1'; });
    }

    svg.appendChild(path);
    startAngle = endAngle;
  });

  // Centre labels
  const tLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  tLabel.setAttribute('x', cx); tLabel.setAttribute('y', cy - 7);
  tLabel.setAttribute('text-anchor', 'middle');
  tLabel.setAttribute('fill', 'var(--text)');
  tLabel.setAttribute('font-size', '14');
  tLabel.setAttribute('font-weight', '700');
  tLabel.textContent = fmt(_root.size);
  svg.appendChild(tLabel);

  const tSub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  tSub.setAttribute('x', cx); tSub.setAttribute('y', cy + 13);
  tSub.setAttribute('text-anchor', 'middle');
  tSub.setAttribute('fill', 'var(--text3)');
  tSub.setAttribute('font-size', '10');
  tSub.textContent = 'total';
  svg.appendChild(tSub);

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = document.createElement('div');
  legend.className = 'pc-legend';

  segs.forEach((seg, i) => {
    const pct      = ((seg.size / total) * 100).toFixed(1);
    const [c1]     = seg.isOther ? ['#6b7280'] : COLORS[i % COLORS.length];
    const canDrill = !seg.isOther && seg.isDir && seg.children && seg.children.length;

    const item = document.createElement('div');
    item.className = canDrill ? 'pc-legend-item pc-clickable' : 'pc-legend-item';
    if (canDrill) item.addEventListener('click', () => _drillTo(seg));

    const dot = document.createElement('span');
    dot.className = 'pc-dot';
    dot.style.background = c1;

    const name = document.createElement('span');
    name.className   = 'pc-leg-name';
    name.textContent = seg.name || seg.path;

    const size = document.createElement('span');
    size.className   = 'pc-leg-size';
    size.textContent = fmt(seg.size);

    const pctEl = document.createElement('span');
    pctEl.className   = 'pc-leg-pct';
    pctEl.textContent = pct + '%';

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(size);
    item.appendChild(pctEl);
    legend.appendChild(item);
  });

  const wrap = document.createElement('div');
  wrap.className = 'pc-wrap';
  wrap.appendChild(svg);
  wrap.appendChild(legend);
  container.appendChild(wrap);
}
