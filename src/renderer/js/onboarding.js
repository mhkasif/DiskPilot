import { el } from './elements.js';
import { triggerScan, showState } from './scan.js';

export function setupOnboarding() {
  el.onbScanBtn.addEventListener('click', () => {
    localStorage.setItem('dt-seen', '1');
    triggerScan();
  });
  el.onbSkipBtn.addEventListener('click', () => {
    localStorage.setItem('dt-seen', '1');
    showState('empty');
  });
}
