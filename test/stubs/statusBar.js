// Test stub for src/renderer/js/statusBar.js: records every status message.
export const statusLog = [];
export function updateStatusBar(msg) { statusLog.push(msg); }
export function flashStatus() {}
