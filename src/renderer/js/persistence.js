import { S } from './state.js';

export function loadSettings() {
  try {
    const raw = localStorage.getItem('dt-settings');
    if (raw) Object.assign(S.settings, JSON.parse(raw));
  } catch (_) {}
  S.unitMode = S.settings.units;
}

export function saveSettings() {
  localStorage.setItem('dt-settings', JSON.stringify(S.settings));
}
