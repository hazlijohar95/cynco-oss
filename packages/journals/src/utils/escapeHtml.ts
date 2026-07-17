const ESCAPE_REGEX = /[&<>"']/g;

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Escapes text for interpolation into HTML the string renderers produce.
// The renderers run on both server (SSR preload) and client (innerHTML), so
// escaping must not depend on a DOM being present.
export function escapeHtml(value: string): string {
  return value.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char]);
}
