import { el } from './elements.js';
import { triggerScan } from './scan.js';

export function setupOnboarding() {
  el.onbScanBtn.addEventListener('click', () => {
    triggerScan();
  });
}
