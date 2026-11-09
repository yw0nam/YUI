/** The file stem a card or preset file export offers the save dialog. */

/** Path separators and control characters, the only characters a file stem may not carry. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is what is stripped.
const UNSAFE_FILE_CHARS = /[\x00-\x1f\x7f/\\]/g;

/** A file stem safe to hand the save dialog: separators and control chars out, `card` when nothing remains. */
export function sanitizeFileStem(name: string): string {
  return name.replace(UNSAFE_FILE_CHARS, "_").trim() || "card";
}
