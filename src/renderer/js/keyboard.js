import { S, findNode } from './state.js';
import { el } from './elements.js';
import { navRows, expandSel, collapseSel, doToggle } from './tree.js';
import { hideCtx } from './contextMenu.js';
import { deleteSelected } from './fileops.js';

export function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target === el.pathInput) return;
    if (e.target.closest('.settings-panel')) return;
    switch (e.key) {
      case 'ArrowDown':  navRows(1,  e.shiftKey); e.preventDefault(); break;
      case 'ArrowUp':    navRows(-1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': expandSel();   e.preventDefault(); break;
      case 'ArrowLeft':  collapseSel(); e.preventDefault(); break;
      case 'Enter': {
        const n = findNode(S.selected || '');
        if (n?.isDir && n.children?.length) doToggle(n.path);
        else if (n) window.dt.openItem(n.path);
        e.preventDefault(); break;
      }
      case 'Delete':
      case 'Backspace': if (S.selectedSet.size && !e.metaKey) deleteSelected(); break;
      case 'Escape': hideCtx(); break;
    }
  });
}
