import { S, findNode } from './state.js';
import { el } from './elements.js';
import { fmt, fmtDate } from './format.js';
import { walkFiles } from './treewalk.js';
import { removeFromTree } from './fileops.js';

let currentDupGroups = [];
let selectedDupPaths = new Set();
let dupSmartMode = 'newest'; // 'newest' | 'oldest' | 'shallowest'

export async function renderDuplicatesPanel() {
  if (!S.tree) {
    el.featurePanel.innerHTML = `
      <div class="panel-header">
        <div class="panel-header-title">🔍 Duplicate File Finder</div>
      </div>
      <div class="panel-body">
        <div class="panel-card" style="padding: 24px; text-align: center;">
          <p>Please scan a directory first before searching for duplicate files.</p>
        </div>
      </div>
    `;
    return;
  }

  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">🔍 Duplicate File Finder</div>
        <div class="panel-header-subtitle">Find exact duplicate files taking up unnecessary space</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn" id="dup-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body" id="dup-body">
      <div class="panel-card" style="padding:40px 20px; text-align:center;" id="dup-progress-card">
        <h3>Scanning for duplicate files…</h3>
        <p id="dup-progress-text" style="color:var(--text2); margin-top:8px;">Preparing candidate list…</p>
        <div class="progress-track" style="margin: 24px auto 0; width: 100%; max-width: 500px;"><div class="progress-bar" id="dup-progress-bar" style="width:0%"></div></div>
        <button class="panel-btn" id="dup-btn-cancel" style="margin-top:24px;">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('dup-btn-close')?.addEventListener('click', () => {
    import('./scan.js').then(m => m.showState('tree'));
  });

  document.getElementById('dup-btn-cancel')?.addEventListener('click', () => {
    window.dt.cancelDuplicates();
  });

  const sizeGroups = new Map();
  walkFiles(S.tree, (f) => {
    if (f.size > 0) {
      const arr = sizeGroups.get(f.size);
      if (arr) arr.push(f.path);
      else sizeGroups.set(f.size, [f.path]);
    }
  });

  const multiFileGroups = [];
  for (const [size, paths] of sizeGroups.entries()) {
    if (paths.length > 1) {
      multiFileGroups.push({ size, paths });
    }
  }

  window.dt.onDupProgress(d => {
    const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0;
    const bar = document.getElementById('dup-progress-bar');
    const txt = document.getElementById('dup-progress-text');
    if (bar) bar.style.width = pct + '%';
    if (txt) {
      if (d.text) txt.textContent = d.text;
      else txt.textContent = `Hashed ${d.done} of ${d.total} files (${pct}%)`;
    }
  });

  const res = await window.dt.findDuplicates(multiFileGroups);
  window.dt.offDupProgress();

  if (!res.ok || !res.groups) {
    if (res.cancelled) {
      import('./scan.js').then(m => m.showState('tree'));
      return;
    }
    document.getElementById('dup-body').innerHTML = `
      <div class="panel-card" style="padding:20px; text-align:center;">
        <p>No duplicates found or error scanning: ${res.error || 'Unknown error'}</p>
      </div>
    `;
    return;
  }

  currentDupGroups = res.groups;
  selectedDupPaths.clear();
  applySmartSelect(dupSmartMode);
  renderGroupResults();
}

function applySmartSelect(mode) {
  dupSmartMode = mode;
  selectedDupPaths.clear();

  for (const group of currentDupGroups) {
    if (!group.files || group.files.length < 2) continue;

    let keeper = group.files[0];
    for (let i = 1; i < group.files.length; i++) {
      const f = group.files[i];
      if (mode === 'newest') {
        if (f.mtime > keeper.mtime) keeper = f;
      } else if (mode === 'oldest') {
        if (f.mtime < keeper.mtime) keeper = f;
      } else if (mode === 'shallowest') {
        const depthF = f.path.split(/[/\\]/).length;
        const depthK = keeper.path.split(/[/\\]/).length;
        if (depthF < depthK) keeper = f;
      }
    }

    for (const f of group.files) {
      if (f.path !== keeper.path) {
        selectedDupPaths.add(f.path);
      }
    }
  }
}

function renderGroupResults() {
  const body = document.getElementById('dup-body');
  if (!body) return;

  if (currentDupGroups.length === 0) {
    body.innerHTML = `
      <div class="panel-card" style="padding:24px; text-align:center;">
        <h3>🎉 No duplicate files found</h3>
        <p style="color:var(--text2); margin-top:8px;">All files in this scan appear to be unique.</p>
      </div>
    `;
    return;
  }

  let totalWasted = 0;
  for (const g of currentDupGroups) {
    totalWasted += g.size * (g.files.length - 1);
  }

  let totalSelectedBytes = 0;
  for (const g of currentDupGroups) {
    for (const f of g.files) {
      if (selectedDupPaths.has(f.path)) {
        totalSelectedBytes += g.size;
      }
    }
  }

  body.innerHTML = `
    <div class="panel-card" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between;">
      <div>
        <strong>${currentDupGroups.length} duplicate groups</strong> (${fmt(totalWasted)} potential space reclaimable)
        <div style="font-size:12px; color:var(--text2); margin-top:4px;">
          Selected: ${selectedDupPaths.size} files (${fmt(totalSelectedBytes)})
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <label style="font-size:12px;">Smart Select:
          <select id="dup-smart-select" class="panel-btn" style="padding:4px 8px; margin-left:4px;">
            <option value="newest" ${dupSmartMode === 'newest' ? 'selected' : ''}>Keep Newest</option>
            <option value="oldest" ${dupSmartMode === 'oldest' ? 'selected' : ''}>Keep Oldest</option>
            <option value="shallowest" ${dupSmartMode === 'shallowest' ? 'selected' : ''}>Keep Shallowest Path</option>
          </select>
        </label>
        <button class="panel-btn panel-btn-danger" id="dup-btn-clean" ${selectedDupPaths.size === 0 ? 'disabled' : ''}>
          Clean Selected (${fmt(totalSelectedBytes)})
        </button>
      </div>
    </div>

    <div id="dup-groups-list"></div>
  `;

  document.getElementById('dup-smart-select')?.addEventListener('change', (e) => {
    applySmartSelect(e.target.value);
    renderGroupResults();
  });

  document.getElementById('dup-btn-clean')?.addEventListener('click', deleteSelectedDuplicates);

  const listEl = document.getElementById('dup-groups-list');

  const CHUNK_SIZE = 50;
  let renderIdx = 0;

  function renderNextChunk() {
    const end = Math.min(renderIdx + CHUNK_SIZE, currentDupGroups.length);
    
    for (; renderIdx < end; renderIdx++) {
      const gIdx = renderIdx;
      const group = currentDupGroups[gIdx];
      
      const groupCard = document.createElement('div');
      groupCard.className = 'dup-group';

      const header = document.createElement('div');
      header.className = 'dup-group-header';
      header.innerHTML = `
        <span>Group #${gIdx + 1} · ${group.files.length} copies (${fmt(group.size)} each)</span>
        <span style="color:var(--danger)">Wasted: ${fmt(group.size * (group.files.length - 1))}</span>
      `;

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'dup-group-items';

      group.files.forEach(file => {
        const row = document.createElement('div');
        row.className = 'dup-item-row';

        const isChecked = selectedDupPaths.has(file.path);

        row.innerHTML = `
          <div class="dup-item-info">
            <input type="checkbox" class="dup-checkbox" data-path="${encodeURIComponent(file.path)}" data-gidx="${gIdx}" ${isChecked ? 'checked' : ''} />
            <span class="dup-item-path" title="${file.path}">${file.path}</span>
          </div>
          <div class="dup-item-meta">
            ${fmtDate(file.mtime)}
          </div>
        `;

        // Checkbox event
        const cb = row.querySelector('.dup-checkbox');
        cb.addEventListener('change', (e) => {
          const p = decodeURIComponent(e.target.dataset.path);
          const groupFiles = currentDupGroups[gIdx].files;
          const groupCheckedCount = groupFiles.filter(f => selectedDupPaths.has(f.path) || (f.path === p && e.target.checked)).length;

          if (e.target.checked) {
            // Guard: cannot check ALL files in a group
            if (groupCheckedCount >= groupFiles.length) {
              e.target.checked = false;
              alert('At least one copy of a duplicate group must be preserved.');
              return;
            }
            selectedDupPaths.add(p);
          } else {
            selectedDupPaths.delete(p);
          }
          
          // Re-render UI: preserve scroll position by recreating the chunk mechanism,
          // or just update header totals. Re-calling renderGroupResults resets pagination.
          // To make it simple, we just update the total selected bytes text and the disabled state of the clean button,
          // instead of doing a full re-render which loses pagination!
          updateSelectionStats();
        });

        // Hover for thumbnail preview if image/video
        row.addEventListener('mouseenter', async () => {
          const ext = file.path.split('.').pop().toLowerCase();
          if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov'].includes(ext)) {
            showThumbnailPreview(row, file.path);
          }
        });

        itemsContainer.appendChild(row);
      });

      groupCard.appendChild(header);
      groupCard.appendChild(itemsContainer);
      listEl.appendChild(groupCard);
    }

    if (renderIdx < currentDupGroups.length) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.className = 'panel-btn';
      loadMoreBtn.textContent = `Load More (${currentDupGroups.length - renderIdx} remaining)`;
      loadMoreBtn.style.margin = '20px auto';
      loadMoreBtn.style.display = 'block';
      loadMoreBtn.onclick = () => {
        loadMoreBtn.remove();
        renderNextChunk();
      };
      listEl.appendChild(loadMoreBtn);
    }
  }

  renderNextChunk();
}

function updateSelectionStats() {
  let totalSelectedBytes = 0;
  for (const g of currentDupGroups) {
    for (const f of g.files) {
      if (selectedDupPaths.has(f.path)) {
        totalSelectedBytes += g.size;
      }
    }
  }
  
  const cleanBtn = document.getElementById('dup-btn-clean');
  if (cleanBtn) {
    cleanBtn.disabled = selectedDupPaths.size === 0;
    cleanBtn.textContent = `Clean Selected (${fmt(totalSelectedBytes)})`;
  }
  
  // Update header text
  const subtitle = document.querySelector('#dup-body .panel-card > div > div');
  if (subtitle) {
    subtitle.textContent = `Selected: ${selectedDupPaths.size} files (${fmt(totalSelectedBytes)})`;
  }
}

async function showThumbnailPreview(rowEl, path) {
  let strip = rowEl.nextElementSibling;
  if (strip && strip.classList.contains('dup-thumb-strip')) return;

  const dataUrl = await window.dt.getThumbnail(path);
  if (!dataUrl) return;

  strip = document.createElement('div');
  strip.className = 'dup-thumb-strip';
  strip.innerHTML = `<img class="dup-thumb" src="${dataUrl}" alt="Preview" /> <span style="font-size:11px; color:var(--text2);">${path}</span>`;
  rowEl.parentNode.insertBefore(strip, rowEl.nextSibling);
}

async function deleteSelectedDuplicates() {
  if (selectedDupPaths.size === 0) return;
  const paths = Array.from(selectedDupPaths);

  const res = await window.dt.deleteItems(paths);
  if (res && res.deleted) {
    for (const p of res.deleted) {
      selectedDupPaths.delete(p);
      removeFromTree(p);
      // Remove from currentDupGroups
      for (const g of currentDupGroups) {
        g.files = g.files.filter(f => f.path !== p);
      }
    }
    // Filter out groups with < 2 files
    currentDupGroups = currentDupGroups.filter(g => g.files.length >= 2);
    renderGroupResults();
  }
}
