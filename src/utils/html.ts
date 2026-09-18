/**
 * Escape a value for interpolation into generated HTML (invoice and statement
 * documents that get printed, emailed and opened in the client portal).
 *
 * These documents are built by string concatenation, so any user-entered text -
 * an invoice note, a client address, a company name - lands in the markup
 * verbatim. A single "<" in a note is enough to swallow the rest of the
 * document, and "&" sequences render as entities.
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
