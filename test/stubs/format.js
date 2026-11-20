// Test stub for src/renderer/js/format.js
// Tests may set globalThis.__fmt to run the real fmt through the real renderer modules.
export const fmt = (n) => (globalThis.__fmt ? globalThis.__fmt(n) : String(n));
export const fmtDate = (n) => String(n);
