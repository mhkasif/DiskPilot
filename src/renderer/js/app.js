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
import { setupColumnResize } from './columnResize.js';

async function init() {
  loadSettings();
  applyTheme(S.settings.theme);

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
  setupColumnResize();

  const firstRun = !localStorage.getItem('dt-seen');
  if (firstRun) {
    showState('onboarding');
  } else {
    const saved = sessionStorage.getItem('dt-lastPath');
    if (saved) el.pathInput.value = saved;
    showState('empty');
  }
}

init().catch(console.error);
