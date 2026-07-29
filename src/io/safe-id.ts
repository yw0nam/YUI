/**
 * TS mirror of the native `sanitize_stem` (src-tauri/src/import_fs.rs) — shared by
 * vrm-selection.ts and speaker-selection.ts to validate a persisted user-option id.
 * `isSafeSanitizedId(id)` is exactly `sanitizeStem(id) === id`: an id is trusted only
 * when it is precisely what the native sanitizer would itself produce, not merely
 * shaped like a plausible one. A charset-only check (e.g. "no separators") would still
 * wrongly trust something like "CON" or "___", which sanitize_stem collapses to
 * "avatar" — trusting the raw form would let remove_user_voice's own
 * sanitize_stem(id) re-derivation resolve to a different, shared "avatar" directory
 * than the one the id claimed to name.
 *
 * fixtures/sanitize-stem-cases.json pins both this and the Rust implementation against
 * the same input/output pairs (src-tauri/src/import_fs.rs's
 * sanitize_stem_matches_the_shared_cross_language_fixture test, and this file's own
 * test) so the two layers cannot silently drift apart again.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: must match the neutralized C0/DEL range.
const UNSAFE_STEM_CHARS = /[\x00-\x1f\x7f\\/<>:"|?*]/;

/** Windows reserved device names. Keep in lockstep with import_fs.rs's RESERVED_STEM_NAMES. */
const RESERVED_STEM_NAMES = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM0",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT0",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
];

function isReservedStemName(s: string): boolean {
  const base = s.split(".")[0].toUpperCase();
  return RESERVED_STEM_NAMES.includes(base);
}

/** Filesystem path-component byte cap — matches import_fs.rs's MAX_STEM_BYTES. */
const MAX_STEM_BYTES = 150;

function isUtf8ContinuationByte(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

/** Truncate `s` to at most `maxBytes` UTF-8 bytes, backing off to the nearest char boundary. */
function truncateAtCharBoundary(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && isUtf8ContinuationByte(bytes[end])) end--;
  return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}

const trimDotsAndWhitespace = (s: string): string => s.replace(/^[.\s]+|[.\s]+$/gu, "");

/**
 * TS reimplementation of the native `sanitize_stem`. Permits arbitrary UTF-8 while
 * neutralizing path separators, ASCII control chars/NUL, Windows-illegal characters,
 * leading/trailing dots/whitespace (so `.`/`..` traversal can't survive), Windows
 * reserved device names, and capping the byte length. Collapses to "avatar" when
 * nothing safe/usable remains.
 */
export function sanitizeStem(stem: string): string {
  const substituted = Array.from(stem)
    .map((c) => (UNSAFE_STEM_CHARS.test(c) ? "_" : c))
    .join("");
  const trimmed = trimDotsAndWhitespace(substituted);
  const capped = trimDotsAndWhitespace(truncateAtCharBoundary(trimmed, MAX_STEM_BYTES));

  if (capped.length === 0 || /^_+$/.test(capped) || isReservedStemName(capped)) {
    return "avatar";
  }
  return capped;
}

/** True only when `id` is exactly what `sanitizeStem` (native `sanitize_stem`) would produce. */
export function isSafeSanitizedId(id: string): boolean {
  return sanitizeStem(id) === id;
}
