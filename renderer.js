/* ═══════════════════════════════════════════════════════════════════════════
   DiskPilot – renderer.js
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const ROW_H  = 26;   // must match --row-h in CSS
const BUFFER = 15;   // extra rows rendered above/below viewport
const MAX_ROWS = 100_000; // safety cap for extremely large scans

// ── App state ─────────────────────────────────────────────────────────────────
const S = {
  tree       : null,
  rows       : [],      // flat array of {node, depth} for every visible row
  expanded   : new Set(),
  selected   : null,
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

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  btnScan        : $('btn-scan'),
  btnRefresh     : $('btn-refresh'),
  btnStop        : $('btn-stop'),
  btnDelete      : $('btn-delete'),
  btnShowFinder  : $('btn-show-finder'),
  btnExpandAll   : $('btn-expand-all'),
  btnCollapseAll : $('btn-collapse-all'),
  btnSettings    : $('btn-settings'),
  driveSelect    : $('drive-select'),
  pathInput      : $('path-input'),
  btnBrowse      : $('btn-browse'),
  unitSelect     : $('unit-select'),
  gridHeader     : $('grid-header'),
  // states
  stateOnboarding: $('state-onboarding'),
  stateEmpty     : $('state-empty'),
  stateScanning  : $('state-scanning'),
  treeWrap       : $('tree-wrap'),
  // scan state
  scanHeadline   : $('scan-headline'),
  scanCurrentPath: $('scan-current-path'),
  scanCurrentSize: $('scan-current-size'),
  scanProgressBar: $('scan-progress-bar'),
  btnCancelScan  : $('btn-cancel-scan'),
  // virtual scroller
  treeScroll     : $('tree-scroll'),
  virtSpacer     : $('virt-spacer'),
  treeInner      : $('tree-inner'),
  // status bar
  sbStatus       : $('sb-status'),
  sbPath         : $('sb-path'),
  sbTotalSize    : $('sb-total-size'),
  sbTotalFiles   : $('sb-total-files'),
  sbScanTime     : $('sb-scan-time'),
  // context menu
  ctxMenu        : $('ctx-menu'),
  // onboarding
  onbScanBtn     : $('onb-scan-btn'),
  onbSkipBtn     : $('onb-skip-btn'),
  btnStartScan   : $('btn-start-scan'),
  // settings
  settingsOverlay: $('settings-overlay'),
  settingsClose  : $('settings-close'),
  themePicker    : $('theme-picker'),
  settingsUnits  : $('settings-units'),
  settingsDepth  : $('settings-expand-depth'),
  toggleHidden   : $('toggle-hidden'),
  // tooltip
  tooltip        : $('tooltip'),
};

// ── Virtual Scroller ──────────────────────────────────────────────────────────
// Renders only the rows visible in the viewport + BUFFER above/below.
// This keeps DOM nodes constant (~30-50) regardless of dataset size.
const VS = {
  _prevStart: -1,
  _prevEnd  : -1,

  update() {
    const total = S.rows.length;
    // Set spacer height = total virtual height
    el.virtSpacer.style.height = (total * ROW_H) + 'px';
    this._prevStart = -1; // force re-render
    this.render();
  },

  render() {
    const scr   = el.treeScroll;
    const total = S.rows.length;
    if (total === 0) { el.treeInner.innerHTML = ''; return; }

    const scrollTop  = scr.scrollTop;
    const viewH      = scr.clientHeight;
    const startIdx   = Math.max(0,       Math.floor(scrollTop / ROW_H) - BUFFER);
    const endIdx     = Math.min(total-1, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

    if (startIdx === this._prevStart && endIdx === this._prevEnd) return;
    this._prevStart = startIdx;
    this._prevEnd   = endIdx;

    // Position the rendered slab
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
    if (rowTop < scrollTop)            el.treeScroll.scrollTop = rowTop - 4;
    else if (rowBottom > scrollTop + viewH) el.treeScroll.scrollTop = rowBottom - viewH + 4;
  },
};

// Wire scroll + resize
el.treeScroll.addEventListener('scroll', () => VS.render(), { passive: true });
new ResizeObserver(() => VS.render()).observe(el.treeScroll);

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  loadSettings();
  applyTheme(S.settings.theme);

  if (window.dt.platform === 'win32') {
    document.body.classList.add('win32');
    const sif = el.ctxMenu.querySelector('[data-action="showInDir"]');
    if (sif) sif.innerHTML = sif.innerHTML.replace('Finder','Explorer');
  }

  await loadDrives();
  setupToolbar();
  setupHeader();
  setupContextMenu();
  setupKeyboard();
  setupMenuListeners();
  setupScanProgress();
  setupSettings();
  setupOnboarding();

  // Decide which initial state to show
  const firstRun = !localStorage.getItem('dt-seen');
  if (firstRun) {
    showState('onboarding');
  } else {
    const saved = sessionStorage.getItem('dt-lastPath');
    if (saved) el.pathInput.value = saved;
    showState('empty');
  }
}

// ── Settings persistence ──────────────────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem('dt-settings');
    if (raw) Object.assign(S.settings, JSON.parse(raw));
  } catch (_) {}
  S.unitMode = S.settings.units;
}

function saveSettings() {
  localStorage.setItem('dt-settings', JSON.stringify(S.settings));
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  S.settings.theme = theme;
  const html = document.documentElement;
  html.classList.remove('theme-light', 'theme-dark');
  if (theme === 'dark')  html.classList.add('theme-dark');
  if (theme === 'light') html.classList.add('theme-light');
  // Sync picker UI
  for (const btn of el.themePicker.querySelectorAll('.theme-opt')) {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  }
  saveSettings();
}

// ── Drives ────────────────────────────────────────────────────────────────────
async function loadDrives() {
  const drives = await window.dt.getDrives();
  el.driveSelect.innerHTML = '';
  for (const d of drives) {
    const o = document.createElement('option');
    o.value = d;
    o.textContent = d.length > 18 ? (d.split('/').pop() || d) : d;
    el.driveSelect.appendChild(o);
  }
  el.driveSelect.addEventListener('change', () => {
    el.pathInput.value = el.driveSelect.value;
  });
  const home = await window.dt.getHomeDir();
  el.pathInput.value = home;
  for (const o of el.driveSelect.options) {
    if (home.startsWith(o.value)) { o.selected = true; break; }
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function setupToolbar() {
  el.btnScan.addEventListener('click',     () => triggerScan());
  el.btnRefresh.addEventListener('click',  () => { if (S.rootPath) triggerScan(S.rootPath); });
  el.btnStop.addEventListener('click',     cancelScan);
  el.btnBrowse.addEventListener('click',   browseScan);
  el.btnStartScan.addEventListener('click', () => triggerScan());
  el.btnDelete.addEventListener('click',   deleteSelected);
  el.btnShowFinder.addEventListener('click', () => { if (S.selected) window.dt.showInDir(S.selected); });
  el.btnExpandAll.addEventListener('click',   expandAll);
  el.btnCollapseAll.addEventListener('click', collapseAll);
  el.btnSettings.addEventListener('click',    openSettings);
  el.unitSelect.addEventListener('change', () => {
    S.unitMode = S.settings.units = el.unitSelect.value;
    saveSettings();
    if (S.tree) VS.update();
  });
  el.pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerScan(); });
}

async function browseScan() {
  const p = await window.dt.selectDir();
  if (p) { el.pathInput.value = p; triggerScan(p); }
}

// ── Scan ──────────────────────────────────────────────────────────────────────
async function triggerScan(dirPath) {
  const p = (dirPath || el.pathInput.value.trim()).replace(/\/+$/, '');
  if (!p) { flashInput(); return; }

  S.rootPath = p;
  S.selected = null;
  S.expanded.clear();
  S.tree     = null;
  S.scanning = true;
  S.scanStart = Date.now();

  sessionStorage.setItem('dt-lastPath', p);
  el.pathInput.value = p;

  showState('scanning');
  el.scanHeadline.textContent    = 'Scanning…';
  el.scanCurrentPath.textContent = p;
  el.scanCurrentSize.textContent = '';
  el.scanProgressBar.style.width = '2%';

  setToolbarBusy(true);
  updateStatusBar('Scanning…', p);

  const result = await window.dt.scan(p);

  S.scanning = false;
  S.scanId   = null;
  setToolbarBusy(false);

  if (!result.ok) {
    updateStatusBar(result.cancelled ? 'Scan cancelled.' : `Error: ${result.error || 'Unknown'}`);
    showState(S.tree ? 'tree' : 'empty');
    return;
  }

  S.tree  = result.data;
  S.scanId = result.scanId;
  if (S.tree.isDir) S.expanded.add(S.tree.path);

  rebuildRows();
  VS.update();
  showState('tree');

  const elapsed = ((Date.now() - S.scanStart) / 1000).toFixed(1);
  updateStatusBar('Scan complete', p, S.tree.size, S.tree.files, S.tree.folders, elapsed);
}

function cancelScan() {
  if (S.scanId) window.dt.cancelScan(S.scanId);
  S.scanning = false;
  S.scanId   = null;
  setToolbarBusy(false);
  updateStatusBar('Scan cancelled.');
  showState(S.tree ? 'tree' : 'empty');
}

function setToolbarBusy(busy) {
  el.btnScan.disabled          = busy;
  el.btnRefresh.disabled       = busy || !S.rootPath;
  el.btnStop.style.display     = busy ? 'inline-flex' : 'none';
  el.btnExpandAll.disabled     = busy || !S.tree;
  el.btnCollapseAll.disabled   = busy || !S.tree;
  el.btnDelete.disabled        = busy || !S.selected;
  el.btnShowFinder.disabled    = busy || !S.selected;
}

function setupScanProgress() {
  window.dt.onScanProgress(d => {
    if (!S.scanning) return;
    el.scanCurrentPath.textContent = d.path;
    el.scanCurrentSize.textContent = fmt(d.size);
    const pct = Math.min(95, Math.log10(Math.max(d.size, 1) + 1) * 10);
    el.scanProgressBar.style.width = pct + '%';
    updateStatusBar(`Scanning… ${fmt(d.size)} found`, d.path);
  });
}

// ── State visibility ──────────────────────────────────────────────────────────
function showState(s) {
  el.stateOnboarding.style.display = s === 'onboarding' ? 'flex' : 'none';
  el.stateEmpty.style.display      = s === 'empty'      ? 'flex' : 'none';
  el.stateScanning.style.display   = s === 'scanning'   ? 'flex' : 'none';
  el.treeWrap.style.display        = s === 'tree'       ? 'flex' : 'none';
  el.gridHeader.style.visibility   = s === 'tree'       ? 'visible' : 'hidden';
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function setupOnboarding() {
  el.onbScanBtn.addEventListener('click', () => {
    localStorage.setItem('dt-seen', '1');
    triggerScan();
  });
  el.onbSkipBtn.addEventListener('click', () => {
    localStorage.setItem('dt-seen', '1');
    showState('empty');
  });
}

// ── Flat row builder ──────────────────────────────────────────────────────────
function rebuildRows() {
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

function sortNodes(nodes) {
  const col = S.sortCol, dir = S.sortDir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (col === 'name') {
      const av = (a.name||'').toLowerCase(), bv = (b.name||'').toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    return ((a[col]||0) - (b[col]||0)) * dir;
  });
}

// ── Row builder ───────────────────────────────────────────────────────────────
function buildRow(node, depth, isEven) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (isEven ? ' even' : '');
  row.dataset.path = node.path;

  // ── Name cell ──────────────────────────────────────────
  const nameCell = document.createElement('div');
  nameCell.className = 'row-name-cell';
  nameCell.style.paddingLeft = (depth * 20 + 6) + 'px';

  // Arrow toggle
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

  // Icon
  const icon = document.createElement('div');
  icon.className = 'row-icon';
  icon.innerHTML = node.isDir ? svgFolder(S.expanded.has(node.path)) : svgFile(node.ext);
  nameCell.appendChild(icon);

  // Name text
  const nameEl = document.createElement('div');
  nameEl.className = 'row-name' + (node.error ? ' is-error' : '');
  nameEl.textContent = node.name;
  nameCell.appendChild(nameEl);
  row.appendChild(nameCell);

  // ── Size bar ────────────────────────────────────────────
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

  // ── Numeric cells ────────────────────────────────────────
  row.appendChild(mkCell('row-cell num row-size',    fmt(node.size)));
  row.appendChild(mkCell('row-cell num row-alloc',   fmt(node.allocated)));
  row.appendChild(mkCell('row-cell num row-files',   fmtN(node.files)));
  row.appendChild(mkCell('row-cell num row-folders', node.isDir ? fmtN(node.folders) : '—'));
  row.appendChild(mkCell('row-cell row-mtime',       fmtDate(node.mtime)));

  // ── Events ──────────────────────────────────────────────
  row.addEventListener('click',        () => selectPath(node.path));
  row.addEventListener('dblclick',     () => {
    if (node.isDir && node.children && node.children.length) doToggle(node.path);
    else window.dt.openItem(node.path);
  });
  row.addEventListener('contextmenu',  e  => showCtx(e, node));

  return row;
}

function mkCell(cls, text) {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text; return d;
}

// ── Expand / collapse ─────────────────────────────────────────────────────────
function doToggle(p) {
  if (S.expanded.has(p)) {
    S.expanded.delete(p);
    // collapse all descendants
    for (const ep of [...S.expanded])
      if (ep.startsWith(p + '/') || ep.startsWith(p + '\\')) S.expanded.delete(ep);
  } else {
    S.expanded.add(p);
  }
  rebuildRows(); VS.update();
}

function expandAll() {
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

function collapseAll() {
  if (!S.tree) return;
  S.expanded.clear();
  if (S.tree.isDir) S.expanded.add(S.tree.path);
  rebuildRows(); VS.update();
}

// ── Selection ─────────────────────────────────────────────────────────────────
function selectPath(p) {
  S.selected = p;
  syncSelection();
  const node = findNode(p);
  if (node) el.sbPath.textContent = node.path;
  el.btnDelete.disabled     = !p;
  el.btnShowFinder.disabled = !p;
}

function syncSelection() {
  for (const r of el.treeInner.querySelectorAll('.tree-row.selected'))
    r.classList.remove('selected');
  if (S.selected) {
    const r = el.treeInner.querySelector(`.tree-row[data-path="${CSS.escape(S.selected)}"]`);
    if (r) r.classList.add('selected');
  }
}

function findNode(p, node = S.tree) {
  if (!node) return null;
  if (node.path === p) return node;
  if (node.children) for (const c of node.children) { const f = findNode(p, c); if (f) return f; }
  return null;
}

// ── Parent size (for bar %) ───────────────────────────────────────────────────
function parentSize(node) {
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

// ── Column sort ───────────────────────────────────────────────────────────────
function setupHeader() {
  for (const cell of el.gridHeader.querySelectorAll('.sortable')) {
    cell.addEventListener('click', () => {
      const col = cell.dataset.col;
      S.sortDir = S.sortCol === col ? (S.sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
      S.sortCol = col;
      syncHeaderArrows();
      rebuildRows(); VS.update();
    });
  }
  syncHeaderArrows();
}

function syncHeaderArrows() {
  for (const c of el.gridHeader.querySelectorAll('.gh-cell')) {
    c.classList.remove('active','asc','desc');
    const a = c.querySelector('.sort-arrow'); if (a) a.textContent = '';
  }
  const ac = el.gridHeader.querySelector(`[data-col="${S.sortCol}"]`);
  if (ac) {
    ac.classList.add('active', S.sortDir);
    const a = ac.querySelector('.sort-arrow');
    if (a) a.textContent = S.sortDir === 'desc' ? '▼' : '▲';
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
function setupContextMenu() {
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

function showCtx(e, node) {
  e.preventDefault(); e.stopPropagation();
  selectPath(node.path);
  el.ctxMenu.style.display = 'block';
  let x = e.clientX, y = e.clientY;
  el.ctxMenu.style.left = x + 'px';
  el.ctxMenu.style.top  = y + 'px';
  const r = el.ctxMenu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  el.ctxMenu.style.left = (x - r.width)  + 'px';
  if (r.bottom > window.innerHeight) el.ctxMenu.style.top  = (y - r.height) + 'px';
}
function hideCtx() { el.ctxMenu.style.display = 'none'; }

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteSelected() {
  if (!S.selected) return;
  const p    = S.selected;
  const res  = await window.dt.deleteItem(p);
  if (!res.ok) {
    if (!res.cancelled && res.error) flashStatus('Delete failed: ' + res.error, true);
    return;
  }
  removeFromTree(p);
  S.selected = null;
  el.btnDelete.disabled     = true;
  el.btnShowFinder.disabled = true;
  el.sbPath.textContent     = '';
  rebuildRows(); VS.update();
  flashStatus(res.method === 'trash' ? 'Moved to Trash ✓' : 'Deleted permanently ✓');
  if (S.tree) updateStatusBar('Scan complete', S.rootPath, S.tree.size, S.tree.files, S.tree.folders);
}

function removeFromTree(p, node = S.tree) {
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

// ── Keyboard nav ──────────────────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target === el.pathInput) return;
    if (e.target.closest('.settings-panel')) return;
    switch (e.key) {
      case 'ArrowDown':  navRows(1);  e.preventDefault(); break;
      case 'ArrowUp':    navRows(-1); e.preventDefault(); break;
      case 'ArrowRight': expandSel();   e.preventDefault(); break;
      case 'ArrowLeft':  collapseSel(); e.preventDefault(); break;
      case 'Enter': {
        const n = findNode(S.selected||'');
        if (n?.isDir && n.children?.length) doToggle(n.path);
        else if (n) window.dt.openItem(n.path);
        e.preventDefault(); break;
      }
      case 'Delete':
      case 'Backspace': if (S.selected && !e.metaKey) deleteSelected(); break;
      case 'Escape': hideCtx(); break;
    }
  });
}

function navRows(dir) {
  const rows = S.rows; if (!rows.length) return;
  let idx = rows.findIndex(r => r.node.path === S.selected);
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  selectPath(rows[idx].node.path);
  VS.scrollToPath(rows[idx].node.path);
}

function expandSel() {
  const n = findNode(S.selected||'');
  if (!n || !n.isDir) return;
  if (!S.expanded.has(n.path)) doToggle(n.path);
  else navRows(1);
}

function collapseSel() {
  const n = findNode(S.selected||'');
  if (!n) return;
  if (n.isDir && S.expanded.has(n.path)) { doToggle(n.path); return; }
  const rows = S.rows;
  const idx  = rows.findIndex(r => r.node.path === S.selected);
  if (idx > 0 && rows[idx].depth > 0) {
    const d = rows[idx].depth;
    for (let j = idx - 1; j >= 0; j--)
      if (rows[j].depth < d) { selectPath(rows[j].node.path); VS.scrollToPath(rows[j].node.path); break; }
  }
}

// ── Menu (app menu) ───────────────────────────────────────────────────────────
function setupMenuListeners() {
  window.dt.onMenu(action => {
    switch (action) {
      case 'scan':         triggerScan(); break;
      case 'refresh':      if (S.rootPath) triggerScan(S.rootPath); break;
      case 'expand-all':   expandAll();   break;
      case 'collapse-all': collapseAll(); break;
    }
  });
}

// ── Settings panel ────────────────────────────────────────────────────────────
function setupSettings() {
  // Theme picker
  for (const btn of el.themePicker.querySelectorAll('.theme-opt')) {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  }
  // Sync initial state
  applyTheme(S.settings.theme);
  el.settingsUnits.value = S.settings.units;
  el.settingsDepth.value = String(S.settings.expandDepth);
  syncToggle(el.toggleHidden, S.settings.showHidden);

  el.settingsUnits.addEventListener('change', () => {
    S.settings.units = S.unitMode = el.settingsUnits.value;
    el.unitSelect.value = S.unitMode;
    saveSettings();
    if (S.tree) VS.update();
  });

  el.settingsDepth.addEventListener('change', () => {
    S.settings.expandDepth = parseInt(el.settingsDepth.value, 10);
    saveSettings();
  });

  el.toggleHidden.addEventListener('click', () => {
    S.settings.showHidden = !S.settings.showHidden;
    syncToggle(el.toggleHidden, S.settings.showHidden);
    saveSettings();
    if (S.tree) { rebuildRows(); VS.update(); }
  });

  el.btnSettings.addEventListener('click',  openSettings);
  el.settingsClose.addEventListener('click', closeSettings);
  el.settingsOverlay.addEventListener('click', e => {
    if (e.target === el.settingsOverlay) closeSettings();
  });
}

function openSettings()  { el.settingsOverlay.style.display = 'flex'; }
function closeSettings() { el.settingsOverlay.style.display = 'none'; }

function syncToggle(btn, state) {
  btn.classList.toggle('on', state);
  btn.setAttribute('aria-checked', String(state));
}

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatusBar(status='', path='', totalSize, totalFiles, totalFolders, elapsed) {
  el.sbStatus.textContent = status;
  el.sbPath.textContent   = path ? (path.length > 60 ? '…' + path.slice(-58) : path) : '';
  if (totalSize !== undefined) {
    el.sbTotalSize.innerHTML  = `Total: <strong>${fmt(totalSize)}</strong>`;
    el.sbTotalFiles.innerHTML = `${fmtN(totalFiles)} files, ${fmtN(totalFolders)} folders`;
    el.sbScanTime.innerHTML   = elapsed ? `Scanned in <strong>${elapsed}s</strong>` : '';
  } else {
    el.sbTotalSize.textContent  = '';
    el.sbTotalFiles.textContent = '';
    el.sbScanTime.textContent   = '';
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────
const GB = 1024**3, MB = 1024**2, KB = 1024;

function fmt(b) {
  if (b == null) return '—';
  switch (S.unitMode) {
    case 'b':  return b.toLocaleString() + ' B';
    case 'kb': return (b/KB).toFixed(1) + ' KB';
    case 'mb': return (b/MB).toFixed(1) + ' MB';
    case 'gb': return (b/GB).toFixed(2) + ' GB';
    default:
      if (b < KB)  return b + ' B';
      if (b < MB)  return (b/KB).toFixed(1) + ' KB';
      if (b < GB)  return (b/MB).toFixed(1) + ' MB';
      return (b/GB).toFixed(2) + ' GB';
  }
}

function fmtN(n) { return (n == null) ? '—' : n.toLocaleString(); }

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}

function barTier(pct) {
  if (pct >= 50) return 'bar-t1';
  if (pct >= 20) return 'bar-t2';
  if (pct >=  5) return 'bar-t3';
  return 'bar-t4';
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
function svgFolder(open) {
  return open
    ? `<svg viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15v8H1z" fill="#f8c555" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/><path d="M1 5.5h14v7H1z" fill="#fde68a" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15v9H1z" fill="#f8c555" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgFile(ext) {
  const MAP = {
    jpg:'#f97316',jpeg:'#f97316',png:'#f97316',gif:'#f97316',webp:'#f97316',svg:'#f97316',
    mp4:'#8b5cf6',mov:'#8b5cf6',avi:'#8b5cf6',mkv:'#8b5cf6',
    mp3:'#06b6d4',wav:'#06b6d4',flac:'#06b6d4',aac:'#06b6d4',
    pdf:'#ef4444',
    zip:'#f59e0b',gz:'#f59e0b',tar:'#f59e0b','7z':'#f59e0b',rar:'#f59e0b',
    js:'#eab308',ts:'#3b82f6',jsx:'#61dafb',tsx:'#61dafb',
    py:'#22c55e',rb:'#ef4444',go:'#06b6d4',rs:'#f97316',
    html:'#f97316',css:'#3b82f6',scss:'#ec4899',
    json:'#eab308',xml:'#10b981',yaml:'#10b981',yml:'#10b981',
    md:'#6366f1',txt:'#94a3b8',
    dmg:'#64748b',pkg:'#64748b',app:'#3b82f6',exe:'#64748b',
  };
  const c = MAP[ext] || '#94a3b8';
  return `<svg viewBox="0 0 16 16"><path d="M3 1h7l3 3v11H3z" fill="${c}" opacity=".15" stroke="${c}" stroke-width=".8" stroke-linejoin="round"/><path d="M10 1v3h3" fill="none" stroke="${c}" stroke-width=".8" stroke-linejoin="round"/><path d="M10 1l3 3" fill="${c}" opacity=".25"/><line x1="5" y1="8"  x2="11" y2="8"  stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".7"/><line x1="5" y1="10" x2="10" y2="10" stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".5"/><line x1="5" y1="12" x2="9"  y2="12" stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".35"/></svg>`;
}

// ── Flash helpers ─────────────────────────────────────────────────────────────
function flashStatus(msg, isError = false) {
  const prev = el.sbStatus.textContent;
  el.sbStatus.style.color = isError ? 'var(--danger)' : 'var(--accent)';
  el.sbStatus.textContent  = msg;
  setTimeout(() => { el.sbStatus.style.color = ''; el.sbStatus.textContent = prev; }, 2500);
}

function flashInput() {
  el.pathInput.style.background = 'rgba(239,68,68,.12)';
  setTimeout(() => { el.pathInput.style.background = ''; }, 500);
}

// ── Tooltip on path hover ─────────────────────────────────────────────────────
el.treeScroll.addEventListener('mouseover', e => {
  const row = e.target.closest('.tree-row');
  if (!row) { el.tooltip.style.display = 'none'; return; }
  el.tooltip.textContent  = row.dataset.path || '';
  el.tooltip.style.display = 'block';
});
el.treeScroll.addEventListener('mousemove', e => {
  el.tooltip.style.left = (e.clientX + 14) + 'px';
  el.tooltip.style.top  = (e.clientY + 18) + 'px';
});
el.treeScroll.addEventListener('mouseleave', () => { el.tooltip.style.display = 'none'; });

// ── Boot ──────────────────────────────────────────────────────────────────────
init().catch(console.error);
