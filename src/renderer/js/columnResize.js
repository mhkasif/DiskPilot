// Column names that have resize handles (must match data-resize attrs in HTML)
const RESIZABLE = ['bar', 'size', 'alloc', 'files', 'folders'];
const MIN_W = { bar: 80, size: 55, alloc: 55, files: 45, folders: 45 };
const STORAGE_KEY = 'dt-col-widths';

export function setupColumnResize() {
  const root = document.documentElement;

  // Restore saved widths
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const col of RESIZABLE) {
      if (saved[col]) root.style.setProperty(`--col-${col}`, saved[col] + 'px');
    }
  } catch (_) {}

  // Wire up handles
  for (const col of RESIZABLE) {
    const handle = document.querySelector(`.col-resize-handle[data-resize="${col}"]`);
    if (!handle) continue;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation(); // don't trigger sort click

      const cell   = handle.closest('.gh-cell');
      const startX = e.clientX;
      const startW = cell.getBoundingClientRect().width;

      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = mv => {
        const newW = Math.max(MIN_W[col], startW + (mv.clientX - startX));
        root.style.setProperty(`--col-${col}`, newW + 'px');
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Persist
        const widths = {};
        for (const c of RESIZABLE) {
          const w = parseInt(getComputedStyle(root).getPropertyValue(`--col-${c}`));
          if (w) widths[c] = w;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
