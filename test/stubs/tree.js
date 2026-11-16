// Test stub for src/renderer/js/tree.js
export const calls = { rebuildRows: 0, update: 0, selectPath: [], scrollToPath: [] };
export function rebuildRows() { calls.rebuildRows++; }
export const VS = { update() { calls.update++; }, scrollToPath(p) { calls.scrollToPath.push(p); } };
export function selectPath(p) { calls.selectPath.push(p); }
export function expandAll() {}
export function collapseAll() {}
