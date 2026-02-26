import { S } from './state.js';
import { el } from './elements.js';
import { saveSettings } from './persistence.js';

export function effectiveTheme(theme) {
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const LOGO_SRC = '../../assets/playstore.png';

export function updateLogoImages() {
  for (const id of ['onb-logo-img', 'about-logo-img']) {
    const img = document.getElementById(id);
    if (img) img.src = LOGO_SRC;
  }
}

export function applyTheme(theme) {
  S.settings.theme = theme;
  const html = document.documentElement;
  html.classList.remove('theme-light', 'theme-dark');
  if (theme === 'dark')  html.classList.add('theme-dark');
  if (theme === 'light') html.classList.add('theme-light');
  for (const btn of el.themePicker.querySelectorAll('.theme-opt')) {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  }
  updateLogoImages();
  saveSettings();
}
