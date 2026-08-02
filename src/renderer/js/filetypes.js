import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';
import { walkFiles } from './treewalk.js';
import { categorize, CATEGORIES } from './categories.js';

export function renderFileTypesPanel() {
  if (!S.tree) {
    el.featurePanel.innerHTML = `
      <div class="panel-header">
        <div class="panel-header-title">📊 File Type Breakdown</div>
      </div>
      <div class="panel-body">
        <div class="panel-card" style="padding:24px; text-align:center;">
          <p>Please scan a directory first to view file type analytics.</p>
        </div>
      </div>
    `;
    return;
  }

  const categoryStats = {};
  for (const cat of CATEGORIES) {
    categoryStats[cat] = { name: cat, size: 0, count: 0 };
  }

  let totalSize = 0;
  let totalFiles = 0;

  walkFiles(S.tree, (file) => {
    const cat = categorize(file.ext);
    categoryStats[cat].size += file.size || 0;
    categoryStats[cat].count += 1;
    totalSize += file.size || 0;
    totalFiles += 1;
  });

  const sortedCategories = Object.values(categoryStats).sort((a, b) => b.size - a.size);

  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">📊 File Type Breakdown</div>
        <div class="panel-header-subtitle">Distribution of disk space across file formats</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn" id="ft-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="panel-card" style="padding:14px 18px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>Total Scanned:</strong> ${totalFiles} files
        </div>
        <div>
          <strong>Total Size:</strong> ${fmt(totalSize)}
        </div>
      </div>

      <div class="panel-card">
        <div class="panel-card-header">Categories</div>
        <div class="panel-card-body" style="padding:0;">
          <table class="flat-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>File Count</th>
                <th>Total Size</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              ${sortedCategories.map(cat => {
                const pct = totalSize > 0 ? ((cat.size / totalSize) * 100).toFixed(1) : '0.0';
                return `
                  <tr>
                    <td><strong>${cat.name}</strong></td>
                    <td>${cat.count}</td>
                    <td>${fmt(cat.size)}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:8px;">
                        <div style="flex:1; height:6px; background:var(--bar-track); border-radius:3px; overflow:hidden;">
                          <div style="width:${pct}%; height:100%; background:var(--accent);"></div>
                        </div>
                        <span style="font-size:11px; width:45px; text-align:right;">${pct}%</span>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('ft-btn-close')?.addEventListener('click', () => {
    import('./scan.js').then(m => m.showState('tree'));
  });
}
