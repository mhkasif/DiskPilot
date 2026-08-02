import { S } from './state.js';
import { el } from './elements.js';
import { rebuildRows, VS } from './tree.js';

let debounceTimer = null;

export function setupFilterBar() {
  if (!el.filterInput) return;

  el.filterInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(parseAndApplyFilter, 120);
  });

  el.filterClearBtn?.addEventListener('click', () => {
    el.filterInput.value = '';
    parseAndApplyFilter();
  });
}

function parseSizeQuery(str) {
  const match = str.match(/^>(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'GB') return num * 1024 * 1024 * 1024;
  if (unit === 'MB') return num * 1024 * 1024;
  if (unit === 'KB') return num * 1024;
  return num;
}

function parseAndApplyFilter() {
  const raw = (el.filterInput.value || '').trim();
  el.filterClearBtn.style.display = raw ? 'inline-flex' : 'none';

  if (!raw) {
    S.filter = null;
    rebuildRows();
    VS.update();
    return;
  }

  const filterObj = { raw, query: '', ext: null, minSize: null, isRegex: false, regex: null };

  if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
    filterObj.isRegex = true;
    try {
      filterObj.regex = new RegExp(raw.slice(1, -1), 'i');
    } catch (_) {
      filterObj.regex = null;
    }
  } else if (raw.toLowerCase().startsWith('ext:')) {
    filterObj.ext = raw.slice(4).toLowerCase().trim();
  } else if (raw.startsWith('>')) {
    filterObj.minSize = parseSizeQuery(raw);
  } else {
    filterObj.query = raw;
  }

  S.filter = filterObj;
  rebuildRows();
  VS.update();
}
