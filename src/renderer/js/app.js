import { S } from './state.js';
import { el } from './elements.js';
import { loadSettings } from './persistence.js';
import { applyTheme } from './theme.js';
import { initTree } from './tree.js';
import { showState } from './scan.js';
import { setupScanProgress } from './scan.js';
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
  setupSettings();
  setupOnboarding();
  setupTooltip();
  setupTreemap();
  setupBarchart();
  setupPiechart();
  setupColumnResize();
  setupUpdateUI();

  const saved = sessionStorage.getItem('dt-lastPath');
  if (saved) el.pathInput.value = saved;
  showState('onboarding');
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
  if (!overlay) return;

  window.dt.onUpdateDownloading?.((data) => {
    overlay.style.display = 'flex';
    title.textContent = `Downloading DiskPilot v${data.version}…`;
    detail.textContent = 'Starting download…';
    bar.style.width = '0%';
    percent.textContent = '0%';
    spinner.classList.remove('done');
  });

  window.dt.onUpdateProgress?.((data) => {
    overlay.style.display = 'flex';
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
    // Hide overlay after a short delay (native dialog will appear)
    setTimeout(() => { overlay.style.display = 'none'; }, 800);
  });

  window.dt.onUpdateError?.(() => {
    overlay.style.display = 'none';
  });
}

init().catch(console.error);
