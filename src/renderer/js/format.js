import { S } from './state.js';

const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;

export function fmt(b) {
  if (b == null) return '—';
  switch (S.unitMode) {
    case 'b':  return b.toLocaleString() + ' B';
    case 'kb': return (b / KB).toFixed(1) + ' KB';
    case 'mb': return (b / MB).toFixed(1) + ' MB';
    case 'gb': return (b / GB).toFixed(2) + ' GB';
    default:
      if (b < KB)  return b + ' B';
      if (b < MB)  return (b / KB).toFixed(1) + ' KB';
      if (b < GB)  return (b / MB).toFixed(1) + ' MB';
      return (b / GB).toFixed(2) + ' GB';
  }
}

export function fmtN(n) {
  return (n == null) ? '—' : n.toLocaleString();
}

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function barTier(pct) {
  if (pct >= 50) return 'bar-t1';
  if (pct >= 20) return 'bar-t2';
  if (pct >=  5) return 'bar-t3';
  return 'bar-t4';
}
