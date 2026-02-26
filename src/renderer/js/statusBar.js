import { el } from './elements.js';
import { fmt, fmtN } from './format.js';

export function updateStatusBar(status = '', path = '', totalSize, totalFiles, totalFolders, elapsed) {
  el.sbStatus.textContent = status;
  el.sbPath.textContent   = path ? (path.length > 60 ? '…' + path.slice(-58) : path) : '';
  if (totalSize !== undefined) {
    el.sbTotalSize.innerHTML  = `Total: <strong>${fmt(totalSize)}</strong>`;
    el.sbTotalFiles.innerHTML = `${fmtN(totalFiles)} files, ${fmtN(totalFolders)} folders`;
    el.sbScanTime.innerHTML   = elapsed ? `Scanned in <strong>${elapsed}s</strong>` : '';
  } else {
    el.sbTotalSize.textContent  = '';
    el.sbTotalFiles.textContent = '';
    el.sbScanTime.textContent   = '';
  }
}

export function flashStatus(msg, isError = false) {
  const prev = el.sbStatus.textContent;
  el.sbStatus.style.color = isError ? 'var(--danger)' : 'var(--accent)';
  el.sbStatus.textContent  = msg;
  setTimeout(() => { el.sbStatus.style.color = ''; el.sbStatus.textContent = prev; }, 2500);
}

export function flashInput() {
  el.pathInput.style.background = 'rgba(239,68,68,.12)';
  setTimeout(() => { el.pathInput.style.background = ''; }, 500);
}
