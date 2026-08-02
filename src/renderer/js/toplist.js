import { S, findNode } from './state.js';
import { el } from './elements.js';
import { fmt, fmtDate } from './format.js';
import { collectFiles } from './treewalk.js';
import { removeFromTree } from './fileops.js';
import { selectPath, VS, rebuildRows } from './tree.js';

let currentTopFiles = [];

export function renderTop100Panel() {
  if (!S.tree) {
    el.featurePanel.innerHTML = `
      <div class="panel-header">
        <div class="panel-header-title">🏆 Top 100 Largest Files</div>
      </div>
      <div class="panel-body">
        <div class="panel-card" style="padding:24px; text-align:center;">
          <p>Please scan a directory first.</p>
        </div>
      </div>
    `;
    return;
  }

  currentTopFiles = collectFiles(S.tree)
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, 100);

  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">🏆 Top 100 Largest Files</div>
        <div class="panel-header-subtitle">The biggest space consumers across your scanned files</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn" id="top-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="panel-card">
        <div class="panel-card-body" style="padding:0;">
          <div class="flat-table-wrap">
            <table class="flat-table">
              <colgroup>
                <col style="width: 55px;" />
                <col style="width: 22%;" />
                <col style="width: 38%;" />
                <col style="width: 90px;" />
                <col style="width: 120px;" />
                <col style="width: 150px;" />
              </colgroup>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>File Name</th>
                  <th>Path</th>
                  <th>Size</th>
                  <th>Last Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${currentTopFiles.map((file, idx) => `
                  <tr>
                    <td><strong>#${idx + 1}</strong></td>
                    <td><strong>${file.name}</strong></td>
                    <td class="cell-path" title="${file.path}">${file.path}</td>
                    <td><strong>${fmt(file.size)}</strong></td>
                    <td>${fmtDate(file.mtime)}</td>
                    <td>
                      <div style="display:flex; gap:6px;">
                        <button class="panel-btn top-btn-reveal" data-path="${encodeURIComponent(file.path)}" title="Reveal in Tree">Tree</button>
                        <button class="panel-btn top-btn-finder" data-path="${encodeURIComponent(file.path)}" title="Show in Finder">Finder</button>
                        <button class="panel-btn panel-btn-danger top-btn-del" data-path="${encodeURIComponent(file.path)}" title="Delete">Delete</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  bindTableActions();
}

let forgottenMinSize = 100 * 1024 * 1024; // 100 MB default
let forgottenMonths = 3; // 3 months default

export function renderForgottenPanel() {
  if (!S.tree) {
    el.featurePanel.innerHTML = `
      <div class="panel-header">
        <div class="panel-header-title">🕒 Forgotten Files</div>
      </div>
      <div class="panel-body">
        <div class="panel-card" style="padding:24px; text-align:center;">
          <p>Please scan a directory first.</p>
        </div>
      </div>
    `;
    return;
  }

  const now = Date.now();
  const msInMonth = 30 * 24 * 60 * 60 * 1000;
  const ageThresholdMs = now - (forgottenMonths * msInMonth);

  currentTopFiles = collectFiles(S.tree).filter(file => {
    if ((file.size || 0) < forgottenMinSize) return false;
    const accessTime = (file.atime && file.atime > 0) ? file.atime : file.mtime;
    return accessTime < ageThresholdMs;
  }).sort((a, b) => (b.size || 0) - (a.size || 0));

  let totalForgottenBytes = 0;
  for (const f of currentTopFiles) totalForgottenBytes += (f.size || 0);

  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">🕒 Forgotten Files</div>
        <div class="panel-header-subtitle">Large files that haven't been accessed or modified in a long time</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn" id="top-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="panel-card" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between;">
        <div>
          <strong>${currentTopFiles.length} forgotten files found</strong> (${fmt(totalForgottenBytes)} total)
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <label style="font-size:12px;">Min Size:
            <select id="forgotten-size-select" class="panel-btn" style="padding:4px;">
              <option value="50" ${forgottenMinSize === 50*1024*1024 ? 'selected' : ''}>> 50 MB</option>
              <option value="100" ${forgottenMinSize === 100*1024*1024 ? 'selected' : ''}>> 100 MB</option>
              <option value="500" ${forgottenMinSize === 500*1024*1024 ? 'selected' : ''}>> 500 MB</option>
              <option value="1000" ${forgottenMinSize === 1000*1024*1024 ? 'selected' : ''}>> 1 GB</option>
            </select>
          </label>
          <label style="font-size:12px;">Unused For:
            <select id="forgotten-age-select" class="panel-btn" style="padding:4px;">
              <option value="1" ${forgottenMonths === 1 ? 'selected' : ''}>> 1 month</option>
              <option value="3" ${forgottenMonths === 3 ? 'selected' : ''}>> 3 months</option>
              <option value="6" ${forgottenMonths === 6 ? 'selected' : ''}>> 6 months</option>
              <option value="12" ${forgottenMonths === 12 ? 'selected' : ''}>> 1 year</option>
            </select>
          </label>
        </div>
      </div>

      <div class="panel-card">
        <div class="panel-card-body" style="padding:0;">
          <div class="flat-table-wrap">
            <table class="flat-table">
              <colgroup>
                <col style="width: 22%;" />
                <col style="width: 38%;" />
                <col style="width: 90px;" />
                <col style="width: 140px;" />
                <col style="width: 150px;" />
              </colgroup>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Path</th>
                  <th>Size</th>
                  <th>Last Access / Mod</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${currentTopFiles.map(file => {
                  const accessTime = (file.atime && file.atime > 0) ? file.atime : file.mtime;
                  return `
                    <tr>
                      <td><strong>${file.name}</strong></td>
                      <td class="cell-path" title="${file.path}">${file.path}</td>
                      <td><strong>${fmt(file.size)}</strong></td>
                      <td>${fmtDate(accessTime)}</td>
                      <td>
                        <div style="display:flex; gap:6px;">
                          <button class="panel-btn top-btn-reveal" data-path="${encodeURIComponent(file.path)}" title="Reveal in Tree">Tree</button>
                          <button class="panel-btn top-btn-finder" data-path="${encodeURIComponent(file.path)}" title="Show in Finder">Finder</button>
                          <button class="panel-btn panel-btn-danger top-btn-del" data-path="${encodeURIComponent(file.path)}" title="Delete">Delete</button>
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
    </div>
  `;

  document.getElementById('forgotten-size-select')?.addEventListener('change', (e) => {
    forgottenMinSize = parseInt(e.target.value, 10) * 1024 * 1024;
    renderForgottenPanel();
  });

  document.getElementById('forgotten-age-select')?.addEventListener('change', (e) => {
    forgottenMonths = parseInt(e.target.value, 10);
    renderForgottenPanel();
  });

  bindTableActions();
}

function bindTableActions() {
  document.getElementById('top-btn-close')?.addEventListener('click', () => {
    import('./scan.js').then(m => m.showState('tree'));
  });

  document.querySelectorAll('.top-btn-finder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const p = decodeURIComponent(e.target.dataset.path);
      window.dt.showInDir(p);
    });
  });

  document.querySelectorAll('.top-btn-reveal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const p = decodeURIComponent(e.target.dataset.path);
      revealInTree(p);
    });
  });

  document.querySelectorAll('.top-btn-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const p = decodeURIComponent(e.target.dataset.path);
      const res = await window.dt.deleteItems([p]);
      if (res && res.deleted && res.deleted.includes(p)) {
        removeFromTree(p);
        currentTopFiles = currentTopFiles.filter(f => f.path !== p);
        e.target.closest('tr').remove();
      }
    });
  });
}

function revealInTree(path) {
  // Expand parent hierarchy in tree
  const parts = path.split(/[/\\]/);
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur += (i === 0 && parts[i] === '' ? '/' : (i === 0 ? parts[i] : '/' + parts[i]));
    if (cur) S.expanded.add(cur);
  }
  rebuildRows();
  selectPath(path);
  VS.scrollToPath(path);
  import('./scan.js').then(m => m.showState('tree'));
}
