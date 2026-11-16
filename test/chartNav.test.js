'use strict';
// Chart views (treemap / bar / pie): one shared "current folder" (S.viewPath, a path string),
// the shared breadcrumb/path helper (chartNav.js) and the context menu on chart items.
// Runs the real renderer modules against the stubs in test/stubs and a tiny fake DOM.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT  = path.join(__dirname, '..');
const JS    = pathToFileURL(path.join(ROOT, 'src/renderer/js') + '/').href;
const STUBS = pathToFileURL(path.join(__dirname, 'stubs') + '/').href;

require('./registerEsmHooks.js');

// ── fake DOM ──────────────────────────────────────────────────────────────────
class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.attrs = {};
    this.classes = new Set(); this._text = ''; this.dataset = {};
    const self = this;
    this.classList = { add: (...c) => c.forEach(x => self.classes.add(x)), remove: (...c) => c.forEach(x => self.classes.delete(x)), toggle() {}, contains: c => self.classes.has(c) };
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  querySelector() { return null; }
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 }; }
  fire(type, over = {}) {
    const e = { type, defaultPrevented: false, stopped: false, button: 0, clientX: 10, clientY: 20,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, target: this, ...over };
    for (const fn of this.listeners[type] || []) fn(e);
    return e;
  }
}
globalThis.document = { createElement: t => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t) };
globalThis.window = { innerWidth: 1000, innerHeight: 800, dt: { trackEvent() {}, opened: [], openItem(p) { this.opened.push(p); } } };
const walk = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach(c => walk(c, pred, out)); return out; };
const hasCls = c => n => n.classes.has(c);

// ── fixture tree ──────────────────────────────────────────────────────────────
const file = (p, size) => ({ name: p.split('/').pop(), path: p, isDir: false, size });
const dir  = (p, children) => ({ name: p.split('/').pop(), path: p, isDir: true, children, size: children.reduce((s, c) => s + c.size, 0) });
function makeTree() {
  return dir('/r', [
    dir('/r/a', [
      dir('/r/a/b', [file('/r/a/b/f1', 50), dir('/r/a/b/g', [file('/r/a/b/g/h', 7)])]),
      file('/r/a/x', 30),
    ]),
    dir('/r/c', [file('/r/c/y', 20)]),
  ]);
}

let nav, tm, bar, pie, ctx, S, el, treeStub, toolbar;
test.before(async () => {
  S = (await import(STUBS + 'state.js')).S;
  el = (await import(STUBS + 'elements.js')).el;
  treeStub = await import(STUBS + 'tree.js');
  nav = await import(JS + 'chartNav.js');
  tm = await import(JS + 'treemap.js');
  bar = await import(JS + 'barchart.js');
  pie = await import(JS + 'piechart.js');
  ctx = await import(JS + 'contextMenu.js');
  toolbar = await import(JS + 'toolbar.js');
});

function fresh() {
  S.tree = makeTree(); S.rootPath = '/r'; S.viewPath = null; S.currentView = 'treemap';
  S.selected = null; S.selectedSet.clear(); S.expanded.clear();
  el.treemapContainer = new FakeEl('div');
  el.chartBreadcrumb  = new FakeEl('div');
  const menu = new FakeEl('div');
  const del = new FakeEl('div'); const sep = new FakeEl('div');
  menu.querySelectorAll = sel => (sel === '[data-hide-in-chart]' ? [sep, del] : []);
  menu.del = del; menu.sep = sep;
  el.ctxMenu = menu;
  treeStub.calls.rebuildRows = 0; treeStub.calls.update = 0;
  treeStub.calls.selectPath.length = 0; treeStub.calls.scrollToPath.length = 0;
}
const crumbTexts = () => el.chartBreadcrumb.children.filter(c => c.classes.has('crumb')).map(c => c.textContent);
const currentCrumb = () => el.chartBreadcrumb.children.find(c => c.classes.has('current'))?.textContent;
const paths = chain => chain.map(n => n.path);

// ── 1. path -> crumb chain ────────────────────────────────────────────────────
test('pathChain: path becomes the node chain from the scan root to that folder', () => {
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/r/a/b')), ['/r', '/r/a', '/r/a/b']);
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/r')), ['/r']);
});

test('pathChain: Windows separators resolve too', () => {
  const win = { name: 'r', path: 'C:\\r', isDir: true, size: 1, children: [{ name: 'a', path: 'C:\\r\\a', isDir: true, size: 1, children: [{ name: 'f', path: 'C:\\r\\a\\f', isDir: false, size: 1 }] }] };
  assert.deepEqual(paths(nav.pathChain(win, 'C:\\r\\a')), ['C:\\r', 'C:\\r\\a']);
});

// ── 2. fallback ───────────────────────────────────────────────────────────────
test('pathChain: a vanished folder falls back to the nearest existing ancestor', () => {
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/r/a/gone/deeper')), ['/r', '/r/a']);
});

test('pathChain: unknown root, null path or sibling-prefix path fall back to the scan root', () => {
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/other/x')), ['/r']);
  assert.deepEqual(paths(nav.pathChain(makeTree(), null)), ['/r']);
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/r/ab')), ['/r']);   // '/r/a' is only a string prefix of '/r/ab'
});

test('pathChain: a file path resolves to its folder (chart roots are folders)', () => {
  assert.deepEqual(paths(nav.pathChain(makeTree(), '/r/a/b/f1')), ['/r', '/r/a', '/r/a/b']);
});

test('pathChain: no tree gives an empty chain', () => {
  assert.deepEqual(nav.pathChain(null, '/r'), []);
});

// ── breadcrumb DOM ────────────────────────────────────────────────────────────
test('buildBreadcrumb: crumbs per chain node, last is current, earlier ones call back; names stay text', () => {
  fresh();
  const evil = { name: '<img src=x onerror=alert(1)>', path: '/r/e', isDir: true, children: [], size: 0 };
  const picked = [];
  nav.buildBreadcrumb(el.chartBreadcrumb, [makeTree(), evil], n => picked.push(n.path));
  assert.deepEqual(crumbTexts(), ['r', '<img src=x onerror=alert(1)>']);
  assert.equal(currentCrumb(), '<img src=x onerror=alert(1)>');
  el.chartBreadcrumb.children[0].fire('click');
  assert.deepEqual(picked, ['/r']);
});

// ── 3. path kept across views ─────────────────────────────────────────────────
test('treemap: opens at S.viewPath with the breadcrumb rebuilt from the root', () => {
  fresh(); S.viewPath = '/r/a/b';
  tm.renderTreemap();
  assert.deepEqual(crumbTexts(), ['r', 'a', 'b']);
  assert.equal(currentCrumb(), 'b');
  const cells = walk(el.treemapContainer, hasCls('tm-cell'));
  assert.equal(cells.length, 2);                       // f1 and g inside /r/a/b
});

test('treemap: drilling and clicking a crumb set S.viewPath', () => {
  fresh();
  tm.renderTreemap();
  const svg = () => el.treemapContainer.children.find(c => c.tag === 'svg');
  const cellFor = name => walk(svg(), hasCls('tm-cell')).find(c => walk(c, n => n.tag === 'text' && n.textContent.startsWith(name)).length);
  cellFor('a').fire('click');
  assert.equal(S.viewPath, '/r/a');
  assert.equal(currentCrumb(), 'a');
  el.chartBreadcrumb.children[0].fire('click');
  assert.equal(S.viewPath, '/r');
});

test('path survives treemap -> bar -> pie -> treemap', () => {
  fresh(); S.viewPath = '/r/a';
  tm.renderTreemap();
  assert.equal(currentCrumb(), 'a');
  bar.renderBarchart();
  assert.equal(currentCrumb(), 'a');
  const rows = walk(el.treemapContainer, hasCls('bc-row'));
  assert.equal(rows.length, 2);                        // b and x
  pie.renderPiechart();
  assert.equal(currentCrumb(), 'a');
  assert.equal(walk(el.treemapContainer, hasCls('pc-legend-item')).length, 2);
  tm.renderTreemap();
  assert.equal(S.viewPath, '/r/a');
});

test('drilling in the bar chart is seen by the pie chart', () => {
  fresh();
  bar.renderBarchart();
  walk(el.treemapContainer, hasCls('bc-row')).find(r => r.classes.has('bc-dir')).fire('click');
  assert.ok(['/r/a', '/r/c'].includes(S.viewPath));
  const chosen = S.viewPath;
  pie.renderPiechart();
  assert.equal(currentCrumb(), chosen.split('/').pop());
});

test('chart views fall back when S.viewPath no longer exists', () => {
  fresh(); S.viewPath = '/r/a/deleted/x';
  bar.renderBarchart();
  assert.equal(currentCrumb(), 'a');
  S.viewPath = '/elsewhere';
  pie.renderPiechart();
  assert.equal(currentCrumb(), 'r');
});

test('a scan of a different root starts at its root, a rescan of the same root keeps the folder', () => {
  fresh(); S.viewPath = '/r/a';
  nav.startScanView('/r');
  assert.equal(S.viewPath, '/r/a');
  nav.startScanView('/');
  assert.equal(S.viewPath, null);
});

// ── 4. tree reveal ────────────────────────────────────────────────────────────
test('revealViewPath: expands ancestors, selects the folder, scrolls it into view', () => {
  fresh(); S.viewPath = '/r/a/b';
  nav.revealViewPath();
  assert.ok(S.expanded.has('/r') && S.expanded.has('/r/a'));
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a/b']);
  assert.deepEqual(treeStub.calls.scrollToPath, ['/r/a/b']);
  assert.ok(treeStub.calls.rebuildRows >= 1 && treeStub.calls.update >= 1);
});

test('revealViewPath: a vanished folder reveals the nearest ancestor', () => {
  fresh(); S.viewPath = '/r/a/gone';
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a']);
});

test('revealViewPath: no view path (never used a chart) changes nothing', () => {
  fresh();
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, []);
});

// ── toolbar wiring ────────────────────────────────────────────────────────────
function wireToolbar() {
  for (const k of ['btnViewTree', 'btnViewTreemap', 'btnViewBarchart', 'btnViewPiechart']) {
    el[k] = new FakeEl('button');
  }
  toolbar.setupToolbar();
  return k => () => el[k].fire('click');
}

test('toolbar: switching chart views keeps the folder; going to the tree reveals it', () => {
  fresh(); S.currentView = 'tree'; S.viewPath = '/r/a';
  const click = wireToolbar();
  click('btnViewTreemap')();
  assert.equal(S.currentView, 'treemap');
  assert.equal(currentCrumb(), 'a');
  click('btnViewBarchart')();
  assert.equal(currentCrumb(), 'a');
  click('btnViewPiechart')();
  assert.equal(currentCrumb(), 'a');
  assert.equal(S.viewPath, '/r/a');
  click('btnViewTree')();
  assert.equal(S.currentView, 'tree');
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a']);
});

test('toolbar: toggling the active chart button off also reveals the folder in the tree', () => {
  fresh(); S.currentView = 'tree'; S.viewPath = '/r/c';
  const click = wireToolbar();
  click('btnViewBarchart')();
  click('btnViewBarchart')();
  assert.equal(S.currentView, 'tree');
  assert.deepEqual(treeStub.calls.selectPath, ['/r/c']);
});

// ── 5. context menu ───────────────────────────────────────────────────────────
const treemapCell = (name) => walk(el.treemapContainer, hasCls('tm-cell')).find(c => walk(c, n => n.tag === 'text' && n.textContent.startsWith(name)).length);

test('treemap tile: right-click opens the menu for that node, Delete hidden, no drill', () => {
  fresh();
  tm.renderTreemap();
  const e = treemapCell('a').fire('contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'block');
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a']);
  assert.equal(el.ctxMenu.del.style.display, 'none');
  assert.equal(el.ctxMenu.sep.style.display, 'none');
  assert.equal(S.viewPath, null);                      // no drill
  assert.equal(currentCrumb(), 'r');
});

test('treemap file tile gets the menu too', () => {
  fresh(); S.viewPath = '/r/a/b';
  tm.renderTreemap();
  treemapCell('f1').fire('contextmenu');
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a/b/f1']);
  assert.equal(el.ctxMenu.del.style.display, 'none');
});

test('treemap right-click does not start a pan', () => {
  fresh();
  tm.renderTreemap();
  const e = treemapCell('a').fire('contextmenu');
  assert.equal(e.stopped, true);                       // does not bubble to the pan/zoom container handlers
});

test('bar row: right-click opens the chart menu without drilling', () => {
  fresh();
  bar.renderBarchart();
  const row = walk(el.treemapContainer, hasCls('bc-row'))[0];
  const e = row.fire('contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'block');
  assert.equal(el.ctxMenu.del.style.display, 'none');
  assert.equal(S.viewPath, null);
  assert.ok(treeStub.calls.selectPath[0].startsWith('/r/'));
});

test('pie segment and legend entry: right-click opens the chart menu without drilling', () => {
  fresh();
  pie.renderPiechart();
  const seg = walk(el.treemapContainer, n => n.tag === 'path' && n.listeners.contextmenu)[0];
  assert.ok(seg, 'pie segment has a contextmenu handler');
  seg.fire('contextmenu');
  assert.equal(el.ctxMenu.del.style.display, 'none');
  const first = treeStub.calls.selectPath.at(-1);
  const leg = walk(el.treemapContainer, hasCls('pc-legend-item'))[0];
  leg.fire('contextmenu');
  assert.equal(treeStub.calls.selectPath.at(-1), first);
  assert.equal(S.viewPath, null);
});

test('pie "Other" slice has no node, so no menu', () => {
  fresh();
  const kids = Array.from({ length: 10 }, (_, i) => file(`/r/k${i}`, 10 + i));
  S.tree = dir('/r', kids);
  pie.renderPiechart();
  const other = walk(el.treemapContainer, hasCls('pc-legend-item')).at(-1);
  const e = other.fire('contextmenu');
  assert.equal(e.defaultPrevented, false);
  assert.deepEqual(treeStub.calls.selectPath, []);
});

test('tree view: Delete is shown again after a chart menu hid it', () => {
  fresh();
  const node = S.tree.children[0];
  const plain = () => ({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 });
  ctx.showCtx(plain(), node, { hideDelete: true });
  assert.equal(el.ctxMenu.del.style.display, 'none');
  ctx.showCtx(plain(), node);
  assert.notEqual(el.ctxMenu.del.style.display, 'none');
  assert.notEqual(el.ctxMenu.sep.style.display, 'none');
});

test('index.html marks the Delete item and its separator as chart-hidden', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const menu = html.slice(html.indexOf('id="ctx-menu"'));
  assert.match(menu, /<div class="ctx-sep" data-hide-in-chart><\/div>\s*<div class="ctx-item ctx-danger" data-action="delete" data-hide-in-chart>/);
});
