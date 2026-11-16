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
    this.classes = new Set(); this._text = ''; this.dataset = {}; this.disabled = false;
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
const docListeners = {};
globalThis.document = {
  createElement: t => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t), getElementById: () => null,
  addEventListener(t, fn) { (docListeners[t] ??= []).push(fn); },
};
const fireDoc = (type, e) => { for (const fn of docListeners[type] || []) fn(e); return e; };
const dt = { trackEvent() {}, opened: [], shown: [], copied: [], deleted: [],
  openItem(p) { this.opened.push(p); }, showInDir(p) { this.shown.push(p); }, copyPath(p) { this.copied.push(p); },
  async deleteItems(p) { this.deleted.push(p); return { cancelled: true, deletedPaths: [] }; },
  scan: async () => ({ ok: false, cancelled: true }) };
globalThis.window = { innerWidth: 1000, innerHeight: 800, dt };
globalThis.sessionStorage = { setItem() {} };
globalThis.ResizeObserver = class { observe() {} };
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

let nav, tm, bar, pie, ctx, S, el, treeStub, toolbar, keyboard, scan;
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
  keyboard = await import(JS + 'keyboard.js');
  scan = await import(JS + 'scan.js');
});

function fresh() {
  S.tree = makeTree(); S.rootPath = '/r'; S.viewPath = null; S.currentView = 'treemap';
  S.selected = null; S.selectedSet.clear(); S.expanded.clear(); S.rows = []; S.settings.showHidden = false;
  dt.opened.length = dt.shown.length = dt.copied.length = dt.deleted.length = 0;
  el.treemapContainer = new FakeEl('div');
  el.chartBreadcrumb  = new FakeEl('div');
  const menu = new FakeEl('div');
  const del = new FakeEl('div'); const sep = new FakeEl('div');
  menu.querySelectorAll = sel => (sel === '[data-hide-in-chart]' ? [sep, del] : []);
  menu.del = del; menu.sep = sep;
  menu.listeners = {};
  el.ctxMenu = menu;
  el.btnDelete = new FakeEl('button');
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

test('pathChain: a POSIX folder named "b\\c" is not mistaken for a child of "b"', () => {
  const t = dir('/r', [dir('/r/b', [file('/r/b/z', 1)]), dir('/r/b\\c', [dir('/r/b\\c/d', [file('/r/b\\c/d/f', 1)])])]);
  assert.deepEqual(paths(nav.pathChain(t, '/r/b\\c')), ['/r', '/r/b\\c']);
  assert.deepEqual(paths(nav.pathChain(t, '/r/b\\c/d')), ['/r', '/r/b\\c', '/r/b\\c/d']);
  assert.deepEqual(paths(nav.pathChain(t, '/r/b')), ['/r', '/r/b']);
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

test('buildBreadcrumb: an unnamed root shows its path; separators sit between crumbs only', () => {
  fresh();
  const root = { name: '', path: '/', isDir: true, size: 1, children: [] };
  const sub1 = { name: 'x', path: '/x', isDir: true, size: 1, children: [] };
  nav.buildBreadcrumb(el.chartBreadcrumb, [root, sub1], () => {});
  assert.deepEqual(crumbTexts(), ['/', 'x']);
  const seps = el.chartBreadcrumb.children.filter(c => c.classes.has('crumb-sep'));
  assert.equal(seps.length, 1);
  assert.equal(seps[0].textContent, ' ›');
  assert.equal(el.chartBreadcrumb.children.length, 3);
  assert.ok(el.chartBreadcrumb.children.every(c => c.tag === 'span'));
  nav.buildBreadcrumb(el.chartBreadcrumb, [sub1], () => {});
  assert.equal(el.chartBreadcrumb.children.length, 1);   // rebuilt from scratch, no separator after the last crumb
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
  assert.equal(currentCrumb(), chosen.split('/').pop());   // the bar chart itself is redrawn at once
  assert.ok(walk(el.treemapContainer, hasCls('bc-row')).length >= 1);
  pie.renderPiechart();
  assert.equal(currentCrumb(), chosen.split('/').pop());
});

test('pie chart: clicking a segment or a legend entry drills in and redraws', () => {
  fresh();
  pie.renderPiechart();
  const seg = walk(el.treemapContainer, n => n.tag === 'path' && n.listeners.click)[0];
  seg.fire('click');
  assert.equal(S.viewPath, '/r/a');
  assert.equal(currentCrumb(), 'a');
  assert.equal(walk(el.treemapContainer, hasCls('pc-legend-item')).length, 2);   // /r/a has b and x
  el.chartBreadcrumb.children[0].fire('click');
  assert.equal(S.viewPath, '/r');
  walk(el.treemapContainer, hasCls('pc-clickable'))[0].fire('click');
  assert.equal(S.viewPath, '/r/a');
});

test('bar chart: clicking a crumb goes up and redraws', () => {
  fresh(); S.viewPath = '/r/a/b';
  bar.renderBarchart();
  el.chartBreadcrumb.children[0].fire('click');
  assert.equal(S.viewPath, '/r');
  assert.equal(currentCrumb(), 'r');
  assert.equal(walk(el.treemapContainer, hasCls('bc-row')).length, 2);
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
  assert.equal(treeStub.calls.rebuildRows, 0);
});

test('revealViewPath: the folder itself is not expanded, only its ancestors', () => {
  fresh(); S.viewPath = '/r/a/b';
  nav.revealViewPath();
  assert.equal(S.expanded.has('/r/a/b'), false);
});

// Row visibility comes from the REAL rebuildRows (test/stubs/tree.js re-uses it), so these pins see faithful S.rows.
test('revealViewPath: target is the scan root -> selection left unchanged', () => {
  fresh(); S.viewPath = '/r';
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, []);
  assert.deepEqual(treeStub.calls.scrollToPath, []);
  assert.equal(treeStub.calls.rebuildRows, 0);         // nothing to reveal, so nothing is rebuilt either
});

test('revealViewPath: a hidden dot-folder falls back to the nearest ancestor that has a row', () => {
  fresh();
  S.tree = dir('/r', [dir('/r/a', [dir('/r/a/.cache', [dir('/r/a/.cache/deep', [file('/r/a/.cache/deep/f', 1)])])])]);
  S.viewPath = '/r/a/.cache/deep';
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a']);
  assert.deepEqual(treeStub.calls.scrollToPath, ['/r/a']);
  S.settings.showHidden = true;
  treeStub.calls.selectPath.length = 0;
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a/.cache/deep']);
});

test('revealViewPath: a filter that hides the folder falls back to a visible ancestor, or changes nothing if only the root is left', () => {
  fresh(); S.viewPath = '/r/a/b';
  S.filter = { query: 'x', raw: 'x' };                 // matches only /r/a/x (and its ancestors)
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, ['/r/a']);
  treeStub.calls.selectPath.length = 0;
  S.filter = { query: 'y', raw: 'y' };                 // matches only /r/c/y: /r/a has no row
  nav.revealViewPath();
  assert.deepEqual(treeStub.calls.selectPath, []);
  assert.deepEqual(treeStub.calls.scrollToPath, ['/r/a']);   // from the first call only
  S.filter = null;
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
  assert.equal(el.chartWrap.style.display, 'flex');
  assert.equal(walk(el.treemapContainer, hasCls('tm-cell')).length, 2);
  el.chartWrap.style.display = 'none';
  click('btnViewBarchart')();
  assert.equal(S.currentView, 'barchart');
  assert.equal(currentCrumb(), 'a');
  assert.equal(el.chartWrap.style.display, 'flex');
  assert.equal(walk(el.treemapContainer, hasCls('bc-row')).length, 2);
  el.chartWrap.style.display = 'none';
  click('btnViewPiechart')();
  assert.equal(S.currentView, 'piechart');
  assert.equal(currentCrumb(), 'a');
  assert.equal(el.chartWrap.style.display, 'flex');
  assert.equal(walk(el.treemapContainer, hasCls('pc-legend-item')).length, 2);
  assert.equal(S.viewPath, '/r/a');
  click('btnViewTree')();
  assert.equal(S.currentView, 'tree');
  assert.equal(el.treeWrap.style.display, 'flex');
  assert.equal(el.chartWrap.style.display, 'none');
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

test('toolbar: toggling the treemap and pie buttons off also reveals the folder', () => {
  for (const [btn, view] of [['btnViewTreemap', 'treemap'], ['btnViewPiechart', 'piechart']]) {
    fresh(); S.currentView = 'tree'; S.viewPath = '/r/c';
    const click = wireToolbar();
    click(btn)();
    assert.equal(S.currentView, view);
    click(btn)();
    assert.equal(S.currentView, 'tree');
    assert.equal(el.treeWrap.style.display, 'flex', view);
    assert.deepEqual(treeStub.calls.selectPath, ['/r/c'], view);
  }
});

test('toolbar: leaving a feature panel or clicking Tree while in the tree does not reveal', () => {
  fresh(); S.currentView = 'panel'; S.viewPath = '/r/c';
  const click = wireToolbar();
  click('btnViewTree')();
  assert.equal(S.currentView, 'tree');
  assert.deepEqual(treeStub.calls.selectPath, []);
  click('btnViewTree')();
  assert.deepEqual(treeStub.calls.selectPath, []);
});

test('triggerScan: a scan of another root resets the chart folder, a rescan of the same root keeps it', async () => {
  fresh(); S.viewPath = '/r/a'; S.rootPath = '/r';
  el.pathInput.value = '/r';
  await scan.triggerScan('/r');
  assert.equal(S.viewPath, '/r/a');
  assert.equal(S.rootPath, '/r');
  await scan.triggerScan('/z');
  assert.equal(S.viewPath, null);
  assert.equal(S.rootPath, '/z');
});

// ── 5. context menu ───────────────────────────────────────────────────────────
const treemapCell = (name) => walk(el.treemapContainer, hasCls('tm-cell')).find(c => walk(c, n => n.tag === 'text' && n.textContent.startsWith(name)).length);
const clickMenu = (action) => el.ctxMenu.fire('click', { target: { closest: () => ({ dataset: { action } }) } });
const noSelectionChange = () => {
  assert.deepEqual(treeStub.calls.selectPath, []);
  assert.equal(S.selectedSet.size, 0);
  assert.equal(S.selected, null);
  assert.equal(el.btnDelete.disabled, false);
};

test('treemap tile: right-click opens the menu, Delete hidden, no drill, tree selection untouched', () => {
  fresh();
  tm.renderTreemap();
  const e = treemapCell('a').fire('contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'block');
  assert.equal(el.ctxMenu.del.style.display, 'none');
  assert.equal(el.ctxMenu.sep.style.display, 'none');
  noSelectionChange();
  assert.equal(S.viewPath, null);                      // no drill
  assert.equal(currentCrumb(), 'r');
});

test('treemap file tile gets the menu too; actions hit exactly the right-clicked node', () => {
  fresh(); S.viewPath = '/r/a/b';
  ctx.setupContextMenu();
  tm.renderTreemap();
  for (const act of ['open', 'showInDir', 'copyPath']) {   // the menu closes after each action
    treemapCell('f1').fire('contextmenu');
    clickMenu(act);
  }
  assert.deepEqual(dt.opened, ['/r/a/b/f1']);
  assert.deepEqual(dt.shown, ['/r/a/b/f1']);
  assert.deepEqual(dt.copied, ['/r/a/b/f1']);
  noSelectionChange();
});

test('chart menu "delete" does nothing even if it were triggered', () => {
  fresh();
  ctx.setupContextMenu();
  tm.renderTreemap();
  S.selectedSet.add('/r/c');                           // a tree selection carried into the chart view
  treemapCell('a').fire('contextmenu');
  clickMenu('delete');
  assert.deepEqual(dt.deleted, []);
});

test('chart menu target is dropped when the menu closes or a tree menu opens', () => {
  fresh();
  ctx.setupContextMenu();
  tm.renderTreemap();
  treemapCell('a').fire('contextmenu');
  ctx.hideCtx();
  clickMenu('open');
  assert.deepEqual(dt.opened, []);                     // hidden menu: stale target gone
  treemapCell('a').fire('contextmenu');
  S.selected = '/r/c';                                 // what the tree menu's selectPath would have set
  ctx.showCtx({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 }, S.tree.children[1]);
  clickMenu('open');
  assert.deepEqual(dt.opened, ['/r/c']);               // tree menu uses the selection, not the earlier chart target '/r/a'
});

test('tree menu: Open, Show in Finder, Copy Path and Delete act on the selection', () => {
  fresh();
  ctx.setupContextMenu();
  S.selected = '/r/c'; S.selectedSet.add('/r/c');
  for (const act of ['open', 'showInDir', 'copyPath', 'delete']) {
    ctx.showCtx({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 }, S.tree.children[1]);
    clickMenu(act);
  }
  assert.deepEqual(dt.opened, ['/r/c']);
  assert.deepEqual(dt.shown, ['/r/c']);
  assert.deepEqual(dt.copied, ['/r/c']);
  assert.deepEqual(dt.deleted, [['/r/c']]);
});

test('tree menu keeps selecting the right-clicked row', () => {
  fresh();
  ctx.showCtx({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 }, S.tree.children[1]);
  assert.deepEqual(treeStub.calls.selectPath, ['/r/c']);
  assert.equal(el.ctxMenu.style.display, 'block');
});

test('tree menu on an already selected row promotes it without clearing the set', () => {
  fresh(); S.selectedSet.add('/r/a'); S.selectedSet.add('/r/c');
  ctx.showCtx({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 }, S.tree.children[1]);
  assert.equal(S.selected, '/r/c');
  assert.equal(S.selectedSet.size, 2);
  assert.deepEqual(treeStub.calls.selectPath, []);
});

test('Delete and Backspace do nothing in a chart view, but still delete in the tree view', async () => {
  fresh(); keyboard.setupKeyboard();
  const key = k => fireDoc('keydown', { key: k, metaKey: false, target: { tagName: 'DIV', closest: () => null }, preventDefault() {} });
  S.selectedSet.add('/r/a');
  for (const v of ['treemap', 'barchart', 'piechart']) {
    S.currentView = v;
    key('Delete'); key('Backspace');
  }
  assert.deepEqual(dt.deleted, []);
  S.currentView = 'tree';
  key('Delete');
  key('Backspace');
  assert.deepEqual(dt.deleted, [['/r/a'], ['/r/a']]);
});

test('toolbar Delete button does nothing in a chart view, but deletes in the tree view', () => {
  fresh(); S.currentView = 'tree';
  wireToolbar();
  S.selectedSet.add('/r/a');
  for (const v of ['treemap', 'barchart', 'piechart']) { S.currentView = v; el.btnDelete.fire('click'); }
  assert.deepEqual(dt.deleted, []);
  S.currentView = 'tree';
  el.btnDelete.fire('click');
  assert.deepEqual(dt.deleted, [['/r/a']]);
});

test('bar row: right-click opens the chart menu without drilling or selecting', () => {
  fresh();
  ctx.setupContextMenu();
  bar.renderBarchart();
  const row = walk(el.treemapContainer, hasCls('bc-row'))[0];
  const e = row.fire('contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'block');
  assert.equal(el.ctxMenu.del.style.display, 'none');
  assert.equal(S.viewPath, null);
  noSelectionChange();
  clickMenu('copyPath');
  assert.deepEqual(dt.copied, ['/r/a']);               // biggest child of /r
});

test('pie segment and legend entry: right-click opens the chart menu without drilling or selecting', () => {
  fresh();
  ctx.setupContextMenu();
  pie.renderPiechart();
  const seg = walk(el.treemapContainer, n => n.tag === 'path' && n.listeners.contextmenu)[0];
  assert.ok(seg, 'pie segment has a contextmenu handler');
  const e1 = seg.fire('contextmenu');
  assert.equal(e1.defaultPrevented, true);
  assert.equal(el.ctxMenu.del.style.display, 'none');
  clickMenu('copyPath');
  assert.deepEqual(dt.copied, ['/r/a']);
  const leg = walk(el.treemapContainer, hasCls('pc-legend-item'))[1];
  const e2 = leg.fire('contextmenu');
  assert.equal(e2.defaultPrevented, true);
  clickMenu('copyPath');
  assert.deepEqual(dt.copied, ['/r/a', '/r/c']);
  assert.equal(S.viewPath, null);
  noSelectionChange();
});

test('pie "Other" slice: the browser menu is suppressed and no stale menu stays open', () => {
  fresh();
  const kids = Array.from({ length: 10 }, (_, i) => file(`/r/k${i}`, 10 + i));
  S.tree = dir('/r', kids);
  pie.renderPiechart();
  el.ctxMenu.style.display = 'block';                  // a menu from an earlier right-click
  const other = walk(el.treemapContainer, hasCls('pc-legend-item')).at(-1);
  const e = other.fire('contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'none');
  noSelectionChange();
  const seg = walk(el.treemapContainer, n => n.tag === 'path' && n.listeners.contextmenu).at(-1);
  el.ctxMenu.style.display = 'block';
  assert.equal(seg.fire('contextmenu').defaultPrevented, true);
  assert.equal(el.ctxMenu.style.display, 'none');
});

test('tree view: Delete is shown again after a chart menu hid it', () => {
  fresh();
  const node = S.tree.children[0];
  const plain = () => ({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 });
  ctx.showCtx(plain(), node, { hideDelete: true, target: node });
  assert.equal(el.ctxMenu.del.style.display, 'none');
  ctx.showCtx(plain(), node);
  assert.notEqual(el.ctxMenu.del.style.display, 'none');
  assert.notEqual(el.ctxMenu.sep.style.display, 'none');
});

test('menu is flipped to stay inside the window', () => {
  fresh();
  window.innerWidth = 100; window.innerHeight = 100;
  el.ctxMenu.getBoundingClientRect = () => ({ width: 40, height: 30, right: 200, bottom: 150 });
  ctx.showCtx({ preventDefault() {}, stopPropagation() {}, clientX: 90, clientY: 80 }, S.tree.children[0]);
  assert.equal(el.ctxMenu.style.left, '50px');
  assert.equal(el.ctxMenu.style.top, '50px');
  window.innerWidth = 1000; window.innerHeight = 800;
});

// ── pan / zoom ────────────────────────────────────────────────────────────────
function setupZoomed() {
  fresh();
  tm.setupTreemap();
  tm.renderTreemap();
}

test('treemap right-click does not start a pan (mousedown, contextmenu, mousemove)', () => {
  setupZoomed();
  el.treemapContainer.fire('mousedown', { button: 0, clientX: 0, clientY: 0 });
  treemapCell('a').fire('contextmenu');
  fireDoc('mousemove', { buttons: 1, clientX: 50, clientY: 0 });
  assert.notEqual(el.treemapContainer.style.cursor, 'grabbing');
});

test('treemap right-click ends a running pan, so the next click still drills', () => {
  setupZoomed();
  el.treemapContainer.fire('mousedown', { button: 0, clientX: 0, clientY: 0 });
  fireDoc('mousemove', { buttons: 1, clientX: 50, clientY: 0 });
  assert.equal(el.treemapContainer.style.cursor, 'grabbing');
  treemapCell('a').fire('contextmenu');
  treemapCell('a').fire('click');
  assert.equal(S.viewPath, '/r/a');
});

test('treemap: a click right after a real pan does not drill', () => {
  setupZoomed();
  el.treemapContainer.fire('mousedown', { button: 0, clientX: 0, clientY: 0 });
  fireDoc('mousemove', { buttons: 1, clientX: 50, clientY: 0 });
  treemapCell('a').fire('click');
  assert.equal(S.viewPath, null);
  fireDoc('mouseup', {});
});

const zoomBtn = () => el.treemapContainer.children[0];
const wheelIn = () => el.treemapContainer.fire('wheel', { deltaY: -1, clientX: 100, clientY: 100 });

test('treemap: zoom is reset by drilling and by a crumb click', () => {
  setupZoomed();
  wheelIn();
  assert.equal(zoomBtn().style.display, 'flex');
  treemapCell('a').fire('click');
  assert.equal(zoomBtn().style.display, 'none');
  wheelIn();
  assert.equal(zoomBtn().style.display, 'flex');
  el.chartBreadcrumb.children[0].fire('click');
  assert.equal(zoomBtn().style.display, 'none');
});

test('treemap: initTreemap resets the zoom for the next render', () => {
  setupZoomed();
  wheelIn();
  tm.initTreemap();
  tm.renderTreemap();
  assert.equal(zoomBtn().style.display, 'none');
});

test('the real state.js declares viewPath (starts at null)', async () => {
  const real = await import(JS + 'state.js?real');       // a URL, not './state.js', so the stub hook does not apply
  assert.ok('viewPath' in real.S);
  assert.equal(real.S.viewPath, null);
});

test('index.html marks the Delete item and its separator as chart-hidden', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const menu = html.slice(html.indexOf('id="ctx-menu"'));
  assert.match(menu, /<div class="ctx-sep" data-hide-in-chart><\/div>\s*<div class="ctx-item ctx-danger" data-action="delete" data-hide-in-chart>/);
});
