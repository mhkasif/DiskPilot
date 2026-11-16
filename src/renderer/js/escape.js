// Escape text before it is inserted into an HTML string (innerHTML, template literals).
// File names, paths and error messages are untrusted; use textContent where no markup is needed.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
