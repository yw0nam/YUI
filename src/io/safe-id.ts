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

// Rust `char::is_whitespace`'s exact set (Unicode White_Space). JS `\s`/`trim()` differ on two
// code points — they exclude U+0085 (NEL) and include U+FEFF (BOM) — which would let this mirror
// and the native trims derive different results from the same input.
const RUST_WHITESPACE =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const DOTS_AND_WHITESPACE_ENDS = new RegExp(
  `^[.${RUST_WHITESPACE}]+|[.${RUST_WHITESPACE}]+$`,
  "gu",
);
const trimDotsAndWhitespace = (s: string): string => s.replace(DOTS_AND_WHITESPACE_ENDS, "");

const WHITESPACE_ENDS = new RegExp(`^[${RUST_WHITESPACE}]+|[${RUST_WHITESPACE}]+$`, "gu");
/** Trim exactly what Rust's `str::trim` trims. */
const trimAsRust = (s: string): string => s.replace(WHITESPACE_ENDS, "");

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

/**
 * TS mirror of the native `short_hash` (import_fs.rs): FNV-1a 64-bit over the UTF-8 bytes,
 * low 24 bits rendered as bare lowercase hex — matches Rust's `{:x}` (no zero padding).
 */
function shortHash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (h & 0xffffffn).toString(16);
}

/**
 * TS mirror of the native `voice_id_from_name` (src-tauri/src/voice_import.rs) — predicts the
 * TTS-server voice id (`[A-Za-z0-9_-]`) an import registers the typed name under, so the naming
 * row can warn about an overwrite before Enter. Losslessness deliberately compares against the
 * raw trimmed name, not the sanitized one — so e.g. "CON" becomes `avatar-<hash>` and cannot
 * collide with a voice literally named "avatar". fixtures/voice-id-cases.json pins both
 * implementations to the same outputs.
 */
export function voiceIdFromName(name: string): string {
  const trimmed = trimAsRust(name);
  let base = "";
  for (const c of sanitizeStem(trimmed)) {
    if (/[A-Za-z0-9-]/.test(c)) base += c;
    else if (!base.endsWith("_")) base += "_";
  }
  base = base.replace(/^_+|_+$/g, "");
  if (base === "") return `voice-${shortHash(trimmed)}`;
  if (base === trimmed) return base;
  const hash = shortHash(trimmed);
  // `base` is ASCII by construction, so length equals its byte count and slicing is safe.
  const cap = MAX_STEM_BYTES - 1 - hash.length;
  if (base.length > cap) base = base.slice(0, cap).replace(/_+$/, "");
  return `${base}-${hash}`;
}
