import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';
import { updateStatusBar } from './statusBar.js';
import { rebuildRows, VS } from './tree.js';

// ── State visibility ──────────────────────────────────────────────────────────
export function showState(s) {
  el.stateOnboarding.style.display = s === 'onboarding' ? 'flex'    : 'none';
  el.stateEmpty.style.display      = s === 'empty'      ? 'flex'    : 'none';
  el.stateScanning.style.display   = s === 'scanning'   ? 'flex'    : 'none';
  el.treeWrap.style.display        = s === 'tree'       ? 'flex'    : 'none';
  el.chartWrap.style.display       = s === 'chart'      ? 'flex'    : 'none';
  el.gridHeader.style.visibility   = s === 'tree'       ? 'visible' : 'hidden';
  // Sync view-toggle active state
  const inView = s === 'tree' || s === 'chart';
  el.btnViewTree.classList.toggle('view-active',  s === 'tree');
  el.btnViewChart.classList.toggle('view-active', s === 'chart');
  el.btnViewTree.disabled  = !inView;
  el.btnViewChart.disabled = !inView || !S.tree;
}

// ── Scan ──────────────────────────────────────────────────────────────────────
export async function triggerScan(dirPath) {
  const p = (dirPath || el.pathInput.value.trim()).replace(/\/+$/, '');
  if (!p) { flashInput(); return; }

  S.rootPath = p;
  S.selected = null;
  S.selectedSet.clear();
  S.anchor   = null;
  S.expanded.clear();
  S.tree     = null;
  S.scanning = true;
  S.scanStart = Date.now();
  S.scanId   = `scan-${Date.now()}`; // set NOW so cancel works immediately

  sessionStorage.setItem('dt-lastPath', p);
  el.pathInput.value = p;

  showState('scanning');
  el.scanHeadline.textContent    = 'Scanning…';
  el.scanCurrentPath.textContent = p;
  el.scanCurrentSize.textContent = '';
  el.scanEta.textContent         = '';
  el.scanProgressBar.style.width = '2%';
  _resetEta();

  setToolbarBusy(true);
  updateStatusBar('Scanning…', p);

  const result = await window.dt.scan(p, S.scanId);

  S.scanning = false;
  S.scanId   = null;
  setToolbarBusy(false);

  if (!result.ok) {
    updateStatusBar(result.cancelled ? 'Scan cancelled.' : `Error: ${result.error || 'Unknown'}`);
    showState(S.tree ? 'tree' : 'empty');
    return;
  }

  S.tree   = result.data;
  S.scanId = result.scanId;
  if (S.tree.isDir) S.expanded.add(S.tree.path);

  rebuildRows();
  VS.update();
  showState('tree');

  const elapsed = ((Date.now() - S.scanStart) / 1000).toFixed(1);
  updateStatusBar('Scan complete', p, S.tree.size, S.tree.files, S.tree.folders, elapsed);
}

export function cancelScan() {
  if (S.scanId) window.dt.cancelScan(S.scanId);
  S.scanning = false;
  S.scanId   = null;
  setToolbarBusy(false);
  updateStatusBar('Scan cancelled.');
  showState(S.tree ? 'tree' : 'empty');
}

export function setToolbarBusy(busy) {
  el.btnScan.disabled          = busy;
  el.btnRefresh.disabled       = busy || !S.rootPath;
  el.btnStop.style.display     = busy ? 'inline-flex' : 'none';
  el.btnExpandAll.disabled     = busy || !S.tree;
  el.btnCollapseAll.disabled   = busy || !S.tree;
  el.btnDelete.disabled        = busy || !S.selectedSet.size;
  el.btnShowFinder.disabled    = busy || !S.selected;
  el.btnViewChart.disabled     = busy || !S.tree;
  el.btnViewTree.disabled      = busy || !S.tree;
}

// ── ETA / rate ────────────────────────────────────────────────────────────────
const ETA_WINDOW = 8;
const _etaSamples = [];

function _resetEta() { _etaSamples.length = 0; }

function _etaText(currentSize) {
  const now = Date.now();
  _etaSamples.push({ t: now, size: currentSize });
  if (_etaSamples.length > ETA_WINDOW) _etaSamples.shift();
  if (_etaSamples.length < 3) return '';
  const oldest = _etaSamples[0];
  const newest = _etaSamples[_etaSamples.length - 1];
  const dt = (newest.t - oldest.t) / 1000;
  const ds = newest.size - oldest.size;
  if (dt < 0.1 || ds <= 0) return '';
  const rate = ds / dt;
  const elapsed = ((now - S.scanStart) / 1000).toFixed(0);
  return `${fmt(rate)}/s · ${elapsed}s elapsed`;
}

export function setupScanProgress() {
  window.dt.onScanProgress(d => {
    if (!S.scanning) return;
    el.scanCurrentPath.textContent = d.path;
    el.scanCurrentSize.textContent = fmt(d.size);
    el.scanEta.textContent = _etaText(d.size);
    const pct = Math.min(95, Math.log10(Math.max(d.size, 1) + 1) * 10);
    el.scanProgressBar.style.width = pct + '%';
    updateStatusBar(`Scanning… ${fmt(d.size)} found`, d.path);
  });
}

function flashInput() {
  el.pathInput.style.background = 'rgba(239,68,68,.12)';
  setTimeout(() => { el.pathInput.style.background = ''; }, 500);
}
