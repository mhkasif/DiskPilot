// Test stub for src/renderer/js/tree.js
// rebuildRows is the REAL one (so S.rows has the faithful visible-row set); everything that touches the DOM is recorded.
import { rebuildRows as realRebuildRows } from '../../src/renderer/js/tree.js';
export const calls = { rebuildRows: 0, update: 0, selectPath: [], scrollToPath: [] };
export function rebuildRows() { calls.rebuildRows++; realRebuildRows(); }
export const VS = { update() { calls.update++; }, scrollToPath(p) { calls.scrollToPath.push(p); } };
export function selectPath(p) { calls.selectPath.push(p); }
export function expandAll() {}
export function collapseAll() {}
export function navRows() {}
export function expandSel() {}
export function collapseSel() {}
export function doToggle() {}
