import { S } from './state.js';
import { el } from './elements.js';
import { saveSettings } from './persistence.js';
import { triggerScan, cancelScan, showState } from './scan.js';
import { renderTreemap, initTreemap } from './treemap.js';
import { deleteSelected } from './fileops.js';
import { expandAll, collapseAll, VS, rebuildRows } from './tree.js';
import { openSettings } from './settings.js';

// ── Drive select ──────────────────────────────────────────────────────────────
export async function loadDrives() {
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

// ── Toolbar buttons ───────────────────────────────────────────────────────────
export function setupToolbar() {
  el.btnScan.addEventListener('click',      () => triggerScan());
  el.btnRefresh.addEventListener('click',   () => { if (S.rootPath) triggerScan(S.rootPath); });
  el.btnStop.addEventListener('click',      cancelScan);
  el.btnBrowse.addEventListener('click',    browseScan);
  el.btnStartScan.addEventListener('click', () => triggerScan());
  el.btnDelete.addEventListener('click',    deleteSelected);
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

  // View toggle (tree ↔ treemap)
  el.btnViewTree.addEventListener('click', () => {
    if (S.tree) showState('tree');
  });
  el.btnViewChart.addEventListener('click', () => {
    if (!S.tree) return;
    initTreemap();
    showState('chart');
    renderTreemap();
  });
}

export async function browseScan() {
  const p = await window.dt.selectDir();
  if (p) { el.pathInput.value = p; triggerScan(p); }
}

// ── Column header sort ────────────────────────────────────────────────────────
export function setupHeader() {
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

export function syncHeaderArrows() {
  for (const c of el.gridHeader.querySelectorAll('.gh-cell')) {
    c.classList.remove('active', 'asc', 'desc');
    const a = c.querySelector('.sort-arrow'); if (a) a.textContent = '';
  }
  const ac = el.gridHeader.querySelector(`[data-col="${S.sortCol}"]`);
  if (ac) {
    ac.classList.add('active', S.sortDir);
    const a = ac.querySelector('.sort-arrow');
    if (a) a.textContent = S.sortDir === 'desc' ? '▼' : '▲';
  }
}

// ── App menu listeners ────────────────────────────────────────────────────────
export function setupMenuListeners() {
  window.dt.onMenu(action => {
    switch (action) {
      case 'scan':         triggerScan(); break;
      case 'refresh':      if (S.rootPath) triggerScan(S.rootPath); break;
      case 'expand-all':   expandAll();   break;
      case 'collapse-all': collapseAll(); break;
    }
  });
}
