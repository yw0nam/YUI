/**
 * Tavern card export — the Rust `export_card_file` command, which opens the OS save
 * dialog and writes the file itself. Deps are injectable so tests never touch a real
 * Tauri runtime; the real Tauri API is lazily imported.
 */

import { type InvokeFn, loadInvoke } from "../user-asset-import";

export type CardExportResult = "written" | "cancelled";

export interface CardExportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
}

/** Path separators and control characters, the only characters a file stem may not carry. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is what is stripped.
const UNSAFE_FILE_CHARS = /[\x00-\x1f\x7f/\\]/g;

/** A file stem safe to hand the save dialog: separators and control chars out, `card` when nothing remains. */
export function sanitizeFileStem(name: string): string {
  return name.replace(UNSAFE_FILE_CHARS, "_").trim() || "card";
}

/** Save the card JSON through the OS save dialog the command opens natively. */
export async function exportCardToFile(
  text: string,
  fileName: string,
  deps?: CardExportDeps,
): Promise<CardExportResult> {
  const d = deps ?? { invoke: await loadInvoke() };
  const written = await d.invoke<boolean>("export_card_file", {
    defaultName: fileName,
    text,
  });
  return written ? "written" : "cancelled";
}
