import { S } from './state.js';
import { el } from './elements.js';
import { fmt } from './format.js';
import { removeFromTree } from './fileops.js';

let currentJunkItems = [];
let selectedJunkPaths = new Set();

export async function renderJunkPanel() {
  const targetPath = S.rootPath || (await window.dt.getHomeDir());

  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">🧹 Developer &amp; System Junk Sweeper</div>
        <div class="panel-header-subtitle">Clean project build artifacts, package manager caches, and log files</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn" id="junk-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body" id="junk-body">
      <div class="panel-card" style="padding:40px 20px; text-align:center;">
        <h3>Scanning for junk files &amp; build artifacts…</h3>
        <p id="junk-progress-text" style="color:var(--text2); margin-top:8px;">Searching in ${targetPath}…</p>
        <div class="progress-track" style="margin: 24px auto 0; width: 100%; max-width: 500px;"><div class="progress-bar indeterminate" id="junk-progress-bar"></div></div>
        <button class="panel-btn" id="junk-btn-cancel" style="margin-top:24px;">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('junk-btn-close')?.addEventListener('click', () => {
    import('./scan.js').then(m => m.showState(S.tree ? 'tree' : 'empty'));
  });

  document.getElementById('junk-btn-cancel')?.addEventListener('click', () => {
    window.dt.cancelJunk();
  });

  window.dt.onJunkProgress(d => {
    const txt = document.getElementById('junk-progress-text');
    if (txt) txt.textContent = `Found ${d.found} junk items… scanning: ${d.current.split('/').pop()}`;
  });

  const res = await window.dt.scanJunk(targetPath);
  window.dt.offJunkProgress();

  if (!res.ok || !res.items) {
    if (res.cancelled) {
      import('./scan.js').then(m => m.showState(S.tree ? 'tree' : 'empty'));
      return;
    }
    document.getElementById('junk-body').innerHTML = `
      <div class="panel-card" style="padding:20px; text-align:center;">
        <p>Error scanning junk files: ${res.error || 'Unknown error'}</p>
      </div>
    `;
    return;
  }

  currentJunkItems = res.items;
  selectedJunkPaths.clear();

  // Default selection: select Developer Artifacts and safe package caches, uncheck caution/readonly
  for (const item of currentJunkItems) {
    if (item.badge === 'safe') {
      selectedJunkPaths.add(item.path);
    }
  }

  renderJunkResults();
}

function renderJunkResults() {
  const body = document.getElementById('junk-body');
  if (!body) return;

  if (currentJunkItems.length === 0) {
    body.innerHTML = `
      <div class="panel-card" style="padding:24px; text-align:center;">
        <h3>✨ System is clean!</h3>
        <p style="color:var(--text2); margin-top:8px;">No major build artifacts or excessive cache directories found.</p>
      </div>
    `;
    return;
  }

  let totalJunkBytes = 0;
  let totalSelectedBytes = 0;

  for (const item of currentJunkItems) {
    totalJunkBytes += item.size;
    if (selectedJunkPaths.has(item.path)) {
      totalSelectedBytes += item.size;
    }
  }

  body.innerHTML = `
    <div class="panel-card" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between;">
      <div>
        <strong>${currentJunkItems.length} items found</strong> (${fmt(totalJunkBytes)} total potential reclaimable)
        <div style="font-size:12px; color:var(--text2); margin-top:4px;">
          Selected: ${selectedJunkPaths.size} items (${fmt(totalSelectedBytes)})
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <button class="panel-btn panel-btn-danger" id="junk-btn-clean" ${selectedJunkPaths.size === 0 ? 'disabled' : ''}>
          Clean Selected (${fmt(totalSelectedBytes)})
        </button>
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-card-header">
        <span>Cleanable Items</span>
        <span style="font-size:11px; color:var(--text3);">System Caches default unchecked for safety</span>
      </div>
      <div class="panel-card-body" style="padding:0;" id="junk-items-list"></div>
    </div>
  `;

  document.getElementById('junk-btn-clean')?.addEventListener('click', cleanSelectedJunk);

  const listEl = document.getElementById('junk-items-list');

  currentJunkItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'junk-row';

    const isChecked = selectedJunkPaths.has(item.path);
    const isReadOnly = item.badge === 'readonly';

    let badgeClass = 'junk-badge-safe';
    if (item.badge === 'caution') badgeClass = 'junk-badge-caution';
    if (item.badge === 'readonly') badgeClass = 'junk-badge-readonly';

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
        <input type="checkbox" class="junk-checkbox" data-path="${encodeURIComponent(item.path)}" ${isChecked ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} />
        <span class="junk-badge ${badgeClass}">${item.category}</span>
        <span style="font-weight:500;">${item.kind}</span>
        <span style="color:var(--text3); font-family:monospace; font-size:11px; overflow:hidden; text-overflow:ellipsis;" title="${item.path}">${item.path}</span>
      </div>
      <div style="font-weight:600; white-space:nowrap; margin-left:16px;">
        ${fmt(item.size)}
      </div>
    `;

    const cb = row.querySelector('.junk-checkbox');
    cb.addEventListener('change', (e) => {
      const p = decodeURIComponent(e.target.dataset.path);
      if (e.target.checked) selectedJunkPaths.add(p);
      else selectedJunkPaths.delete(p);
      renderJunkResults();
    });

    listEl.appendChild(row);
  });
}

async function cleanSelectedJunk() {
  if (selectedJunkPaths.size === 0) return;
  const paths = Array.from(selectedJunkPaths);

  const res = await window.dt.deleteItems(paths);
  if (res && res.deleted) {
    for (const p of res.deleted) {
      selectedJunkPaths.delete(p);
      removeFromTree(p);
      currentJunkItems = currentJunkItems.filter(i => i.path !== p);
    }
    renderJunkResults();
  }
}
