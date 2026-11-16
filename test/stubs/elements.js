// Test stub for src/renderer/js/elements.js: every property is a recording fake element.
function makeEl() {
  return { style: {}, classList: { toggle() {}, add() {}, remove() {} }, textContent: '', innerHTML: '', value: '', disabled: false, addEventListener() {} };
}
export const el = new Proxy({}, { get(t, k) { return (t[k] ??= makeEl()); } });
