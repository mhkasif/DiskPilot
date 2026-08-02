import { S } from './state.js';
import { el } from './elements.js';
import { loadSettings } from './persistence.js';
import { applyTheme } from './theme.js';
import { initTree } from './tree.js';
import { showState } from './scan.js';
import { setupScanProgress } from './scan.js';
import { setupDeleteProgress } from './fileops.js';
import { setupContextMenu } from './contextMenu.js';
import { setupKeyboard } from './keyboard.js';
import { loadDrives, setupToolbar, setupHeader, setupMenuListeners } from './toolbar.js';
import { setupSettings } from './settings.js';
import { setupOnboarding } from './onboarding.js';
import { setupTooltip } from './tooltip.js';
import { setupTreemap } from './treemap.js';
import { setupBarchart } from './barchart.js';
import { setupPiechart } from './piechart.js';
import { setupColumnResize } from './columnResize.js';
import { setupFilterBar } from './filter.js';
import { renderDuplicatesPanel } from './duplicates.js';
import { renderJunkPanel } from './junk.js';
import { renderFileTypesPanel } from './filetypes.js';
import { renderTop100Panel, renderForgottenPanel } from './toplist.js';

async function init() {
  loadSettings();
  applyTheme(S.settings.theme);

  // Set dynamic version in the About section
  const aboutVer = document.getElementById('about-version');
  if (aboutVer) aboutVer.textContent = `Version ${window.dt.appVersion || ''}`;

  if (window.dt.platform === 'win32') {
    document.body.classList.add('win32');
    const sif = el.ctxMenu.querySelector('[data-action="showInDir"]');
    if (sif) sif.innerHTML = sif.innerHTML.replace('Finder', 'Explorer');
  }

  initTree();
  await loadDrives();
  setupToolbar();
  setupHeader();
  setupContextMenu();
  setupKeyboard();
  setupMenuListeners();
  setupScanProgress();
  setupDeleteProgress();
  setupSettings();
  setupOnboarding();
  setupTooltip();
  setupTreemap();
  setupBarchart();
  setupPiechart();
  setupColumnResize();
  setupFilterBar();
  setupToolsMenu();
  setupUpdateUI();

  const saved = sessionStorage.getItem('dt-lastPath');
  if (saved) el.pathInput.value = saved;
  showState('onboarding');
}

function setupToolsMenu() {
  if (!el.btnTools || !el.toolsMenu) return;

  el.btnTools.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = el.toolsMenu.style.display === 'block';
    el.toolsMenu.style.display = isVisible ? 'none' : 'block';
  });

  document.addEventListener('click', () => {
    if (el.toolsMenu) el.toolsMenu.style.display = 'none';
  });

  el.toolsMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-tool]');
    if (!item) return;
    const tool = item.dataset.tool;
    el.toolsMenu.style.display = 'none';

    showState('panel');
    S.activePanel = tool;

    switch (tool) {
      case 'duplicates': renderDuplicatesPanel(); break;
      case 'junk':       renderJunkPanel();       break;
      case 'filetypes':  renderFileTypesPanel();  break;
      case 'top100':     renderTop100Panel();     break;
      case 'forgotten':  renderForgottenPanel();  break;
    }
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function setupUpdateUI() {
  const overlay   = document.getElementById('update-overlay');
  const title     = document.getElementById('update-title');
  const detail    = document.getElementById('update-detail');
  const bar       = document.getElementById('update-progress-bar');
  const percent   = document.getElementById('update-percent');
  const spinner   = document.getElementById('update-spinner');
  const actionBtn = document.getElementById('update-action-btn');
  const track     = overlay?.querySelector('.update-progress-track');
  if (!overlay) return;

  const showProgressUI = () => {
    if (track)     track.style.display = '';
    if (percent)   percent.style.display = '';
    if (actionBtn) actionBtn.style.display = 'none';
  };

  window.dt.onUpdateDownloading?.((data) => {
    overlay.style.display = 'flex';
    showProgressUI();
    title.textContent = `Downloading DiskPilot v${data.version}…`;
    detail.textContent = 'Starting download…';
    bar.style.width = '0%';
    percent.textContent = '0%';
    spinner.classList.remove('done');
  });

  window.dt.onUpdateProgress?.((data) => {
    overlay.style.display = 'flex';
    showProgressUI();
    bar.style.width = data.percent + '%';
    percent.textContent = data.percent + '%';
    const speed = formatBytes(data.bytesPerSecond) + '/s';
    const done  = formatBytes(data.transferred);
    const total = formatBytes(data.total);
    detail.textContent = `${done} / ${total}  •  ${speed}`;
  });

  window.dt.onUpdateDownloaded?.((data) => {
    bar.style.width = '100%';
    percent.textContent = '100%';
    title.textContent = `DiskPilot v${data.version} Ready!`;
    detail.textContent = 'Preparing to install…';
    spinner.classList.add('done');
    // On macOS an instructional 'update:manual' event follows and keeps the
    // overlay open; on Windows/Linux the native restart dialog takes over.
    setTimeout(() => {
      if (window.dt.platform !== 'darwin') overlay.style.display = 'none';
    }, 800);
  });

  // macOS: app is unsigned and can't auto-install — show manual-install steps.
  window.dt.onUpdateManual?.((data) => {
    overlay.style.display = 'flex';
    spinner.classList.add('done');
    title.textContent = `Update Ready — Manual Install`;
    detail.innerHTML =
      `Drag <strong>DiskPilot</strong> to Applications, then if macOS says it's ` +
      `&ldquo;damaged&rdquo; run in Terminal:<br><code>xattr -cr /Applications/DiskPilot.app</code>`;
    if (track)   track.style.display = 'none';
    if (percent) percent.style.display = 'none';
    if (actionBtn) {
      actionBtn.style.display = '';
      actionBtn.textContent = 'Got it';
      actionBtn.onclick = () => { overlay.style.display = 'none'; };
    }
  });

  window.dt.onUpdateError?.(() => {
    overlay.style.display = 'none';
  });
}

init().catch(console.error);
