// Test stub for src/renderer/js/tree.js
export const calls = { rebuildRows: 0, update: 0 };
export function rebuildRows() { calls.rebuildRows++; }
export const VS = { update() { calls.update++; } };
