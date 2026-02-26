import { S } from './state.js';
import { el } from './elements.js';
import { saveSettings } from './persistence.js';
import { applyTheme } from './theme.js';
import { VS, rebuildRows } from './tree.js';

export function setupSettings() {
  // Theme picker
  for (const btn of el.themePicker.querySelectorAll('.theme-opt')) {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  }
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

  el.settingsClose.addEventListener('click',   closeSettings);
  el.settingsOverlay.addEventListener('click', e => {
    if (e.target === el.settingsOverlay) closeSettings();
  });
}

export function openSettings()  { el.settingsOverlay.style.display = 'flex'; }
export function closeSettings() { el.settingsOverlay.style.display = 'none'; }

export function syncToggle(btn, state) {
  btn.classList.toggle('on', state);
  btn.setAttribute('aria-checked', String(state));
}
