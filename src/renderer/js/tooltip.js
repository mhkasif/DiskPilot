import { el } from './elements.js';

export function setupTooltip() {
  el.treeScroll.addEventListener('mouseover', e => {
    const row = e.target.closest('.tree-row');
    if (!row) { el.tooltip.style.display = 'none'; return; }
    el.tooltip.textContent   = row.dataset.path || '';
    el.tooltip.style.display = 'block';
  });
  el.treeScroll.addEventListener('mousemove', e => {
    el.tooltip.style.left = (e.clientX + 14) + 'px';
    el.tooltip.style.top  = (e.clientY + 18) + 'px';
  });
  el.treeScroll.addEventListener('mouseleave', () => {
    el.tooltip.style.display = 'none';
  });
}
