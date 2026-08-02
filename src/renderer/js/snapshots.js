import { S } from './state.js';
import { el } from './elements.js';
import { fmt, fmtDate } from './format.js';

let snapshotList = [];

export async function renderSnapshotsPanel() {
  el.featurePanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-header-title">📸 Scan Snapshots &amp; Growth Diffing</div>
        <div class="panel-header-subtitle">Save scan snapshots over time and compare storage growth</div>
      </div>
      <div class="panel-actions">
        <button class="panel-btn panel-btn-primary" id="snap-btn-save" ${!S.tree ? 'disabled' : ''}>+ Save Current Scan</button>
        <button class="panel-btn" id="snap-btn-close">Back to Tree</button>
      </div>
    </div>
    <div class="panel-body" id="snap-body">
      <div class="panel-card" style="padding:20px; text-align:center;">
        <p>Loading snapshots…</p>
      </div>
    </div>
  `;

  document.getElementById('snap-btn-close')?.addEventListener('click', () => {
    import('./scan.js').then(m => m.showState(S.tree ? 'tree' : 'empty'));
  });

  document.getElementById('snap-btn-save')?.addEventListener('click', async () => {
    if (!S.tree || !S.rootPath) return;
    const btn = document.getElementById('snap-btn-save');
    if (btn) btn.disabled = true;
    const res = await window.dt.saveSnapshot({ tree: S.tree, rootPath: S.rootPath });
    if (res.ok) {
      loadSnapshotsList();
    } else {
      alert(`Failed to save snapshot: ${res.error}`);
    }
  });

  loadSnapshotsList();
}

async function loadSnapshotsList() {
  const res = await window.dt.listSnapshots();
  if (res.ok) {
    snapshotList = res.list || [];
  } else {
    snapshotList = [];
  }
  renderSnapshotListUI();
}

function renderSnapshotListUI() {
  const body = document.getElementById('snap-body');
  if (!body) return;

  if (snapshotList.length === 0) {
    body.innerHTML = `
      <div class="panel-card" style="padding:24px; text-align:center;">
        <h3>No snapshots saved yet</h3>
        <p style="color:var(--text2); margin-top:8px;">
          ${S.tree ? 'Click <strong>+ Save Current Scan</strong> above to create your first snapshot.' : 'Scan a directory and click Save Current Scan to track growth over time.'}
        </p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="panel-card" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between;">
      <div>
        <strong>${snapshotList.length} saved snapshots</strong>
        <div style="font-size:12px; color:var(--text2); margin-top:4px;">
          Select two snapshots below to analyze storage changes.
        </div>
      </div>
      <button class="panel-btn panel-btn-primary" id="snap-btn-compare" disabled>Compare Selected Snapshots</button>
    </div>

    <div class="panel-card">
      <div class="panel-card-header">
        <span>Saved Snapshots</span>
      </div>
      <div class="panel-card-body" style="padding:0;" id="snapshot-items"></div>
    </div>

    <div id="diff-results-card"></div>
  `;

  const container = document.getElementById('snapshot-items');
  const selectedSnapIds = new Set();

  snapshotList.forEach(snap => {
    const row = document.createElement('div');
    row.className = 'snapshot-card';
    row.style.margin = '0';
    row.style.borderRadius = '0';
    row.style.borderBottom = '1px solid var(--border)';

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <input type="checkbox" class="snap-cb" data-id="${snap.id}" />
        <div>
          <strong style="font-size:13px;">${snap.rootPath}</strong>
          <div style="font-size:11px; color:var(--text3); margin-top:2px;">Saved ${fmtDate(snap.savedAt)}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:16px;">
        <div style="text-align:right;">
          <strong style="font-size:13px;">${fmt(snap.totalSize)}</strong>
          <div style="font-size:11px; color:var(--text3);">${snap.files} files</div>
        </div>
        <button class="panel-btn panel-btn-danger snap-btn-del" data-id="${snap.id}">Delete</button>
      </div>
    `;

    row.querySelector('.snap-cb').addEventListener('change', (e) => {
      if (e.target.checked) {
        if (selectedSnapIds.size >= 2) {
          e.target.checked = false;
          alert('Select exactly two snapshots to compare.');
          return;
        }
        selectedSnapIds.add(snap.id);
      } else {
        selectedSnapIds.delete(snap.id);
      }

      const cmpBtn = document.getElementById('snap-btn-compare');
      if (cmpBtn) cmpBtn.disabled = selectedSnapIds.size !== 2;
    });

    row.querySelector('.snap-btn-del').addEventListener('click', async () => {
      await window.dt.deleteSnapshot(snap.id);
      loadSnapshotsList();
    });

    container.appendChild(row);
  });

  document.getElementById('snap-btn-compare')?.addEventListener('click', async () => {
    const ids = Array.from(selectedSnapIds);
    if (ids.length !== 2) return;

    // Load both snapshots
    const resA = await window.dt.loadSnapshot(ids[0]);
    const resB = await window.dt.loadSnapshot(ids[1]);

    if (resA.ok && resB.ok) {
      // Ensure older snapshot is A and newer is B
      let snapA = resA.data;
      let snapB = resB.data;
      if (snapA.savedAt > snapB.savedAt) {
        const tmp = snapA; snapA = snapB; snapB = tmp;
      }
      runTreeDiff(snapA, snapB);
    }
  });
}

function mapTreePaths(node, map) {
  if (!node) return;
  map.set(node.path, { path: node.path, name: node.name, isDir: node.isDir, size: node.size || 0 });
  if (node.isDir && node.children) {
    for (const c of node.children) mapTreePaths(c, map);
  }
}

function runTreeDiff(snapA, snapB) {
  const mapA = new Map();
  const mapB = new Map();

  mapTreePaths(snapA.tree, mapA);
  mapTreePaths(snapB.tree, mapB);

  const allPaths = new Set([...mapA.keys(), ...mapB.keys()]);
  const diffItems = [];

  for (const p of allPaths) {
    const itemA = mapA.get(p);
    const itemB = mapB.get(p);

    const sizeA = itemA ? itemA.size : 0;
    const sizeB = itemB ? itemB.size : 0;
    const delta = sizeB - sizeA;

    if (delta === 0) continue;

    let type = 'changed';
    if (!itemA) type = 'added';
    else if (!itemB) type = 'removed';
    else if (delta > 0) type = 'grew';
    else if (delta < 0) type = 'shrank';

    diffItems.push({
      path: p,
      name: (itemB || itemA).name,
      isDir: (itemB || itemA).isDir,
      sizeA,
      sizeB,
      delta,
      type,
    });
  }

  // Sort by absolute delta size descending
  diffItems.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const totalDelta = snapB.tree.size - snapA.tree.size;
  const targetCard = document.getElementById('diff-results-card');

  targetCard.innerHTML = `
    <div class="panel-card" style="margin-top:20px;">
      <div class="panel-card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <span>Diff Results: ${fmtDate(snapA.savedAt)} → ${fmtDate(snapB.savedAt)}</span>
        <span>Net Growth: <strong class="${totalDelta >= 0 ? 'diff-badge-plus' : 'diff-badge-minus'}">${totalDelta >= 0 ? '+' : ''}${fmt(totalDelta)}</strong></span>
      </div>
      <div class="panel-card-body" style="padding:0;">
        <table class="flat-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Path</th>
              <th>Old Size</th>
              <th>New Size</th>
              <th>Net Change</th>
            </tr>
          </thead>
          <tbody>
            ${diffItems.slice(0, 200).map(item => {
              let badgeHtml = '<span class="diff-badge-new">NEW</span>';
              if (item.type === 'removed') badgeHtml = '<span class="diff-badge-del">DELETED</span>';
              else if (item.type === 'grew') badgeHtml = '<span class="diff-badge-plus">▲ GREW</span>';
              else if (item.type === 'shrank') badgeHtml = '<span class="diff-badge-minus">▼ SHRANK</span>';

              const deltaStr = (item.delta >= 0 ? '+' : '') + fmt(item.delta);
              const deltaClass = item.delta >= 0 ? 'diff-badge-plus' : 'diff-badge-minus';

              return `
                <tr>
                  <td>${badgeHtml}</td>
                  <td style="font-family:monospace; font-size:11px;" title="${item.path}">${item.path}</td>
                  <td>${item.sizeA > 0 ? fmt(item.sizeA) : '—'}</td>
                  <td>${item.sizeB > 0 ? fmt(item.sizeB) : '—'}</td>
                  <td class="${deltaClass}"><strong>${deltaStr}</strong></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
