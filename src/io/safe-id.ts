/**
 * Safety check for a persisted user-option id — shared by vrm-selection.ts and
 * speaker-selection.ts. Matches what the native `sanitize_stem` (src-tauri/src/import_fs.rs)
 * can produce: it permits arbitrary UTF-8, but never a path separator, an ASCII control
 * char, a Windows-illegal character, or a leading/trailing dot/whitespace (sanitize_stem
 * trims those, so a genuine sanitized id never carries them).
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: must match the neutralized C0/DEL range.
const UNSAFE_ID_CHARS = /[\x00-\x1f\x7f\\/<>:"|?*]/;

/** True for an id shaped like a real `sanitize_stem` output — safe to trust from storage. */
export function isSafeSanitizedId(id: string): boolean {
  if (id.length === 0) return false;
  if (UNSAFE_ID_CHARS.test(id)) return false;
  return id === id.trim() && !id.startsWith(".") && !id.endsWith(".");
}
