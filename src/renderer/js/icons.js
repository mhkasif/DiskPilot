export function svgFolder(open) {
  return open
    ? `<svg viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15v8H1z" fill="#f8c555" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/><path d="M1 5.5h14v7H1z" fill="#fde68a" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15v9H1z" fill="#f8c555" stroke="#e0a020" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

export function svgFile(ext) {
  const MAP = {
    jpg:'#f97316', jpeg:'#f97316', png:'#f97316', gif:'#f97316', webp:'#f97316', svg:'#f97316',
    mp4:'#8b5cf6', mov:'#8b5cf6', avi:'#8b5cf6', mkv:'#8b5cf6',
    mp3:'#06b6d4', wav:'#06b6d4', flac:'#06b6d4', aac:'#06b6d4',
    pdf:'#ef4444',
    zip:'#f59e0b', gz:'#f59e0b', tar:'#f59e0b', '7z':'#f59e0b', rar:'#f59e0b',
    js:'#eab308',  ts:'#3b82f6', jsx:'#61dafb', tsx:'#61dafb',
    py:'#22c55e',  rb:'#ef4444', go:'#06b6d4',  rs:'#f97316',
    html:'#f97316', css:'#3b82f6', scss:'#ec4899',
    json:'#eab308', xml:'#10b981', yaml:'#10b981', yml:'#10b981',
    md:'#6366f1',   txt:'#94a3b8',
    dmg:'#64748b',  pkg:'#64748b', app:'#3b82f6', exe:'#64748b',
  };
  const c = MAP[ext] || '#94a3b8';
  return `<svg viewBox="0 0 16 16"><path d="M3 1h7l3 3v11H3z" fill="${c}" opacity=".15" stroke="${c}" stroke-width=".8" stroke-linejoin="round"/><path d="M10 1v3h3" fill="none" stroke="${c}" stroke-width=".8" stroke-linejoin="round"/><path d="M10 1l3 3" fill="${c}" opacity=".25"/><line x1="5" y1="8"  x2="11" y2="8"  stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".7"/><line x1="5" y1="10" x2="10" y2="10" stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".5"/><line x1="5" y1="12" x2="9"  y2="12" stroke="${c}" stroke-width=".9" stroke-linecap="round" opacity=".35"/></svg>`;
}
