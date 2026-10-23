/**
 * Tavern card export — OS save dialog → native write. Deps are injectable so tests
 * never touch a real Tauri runtime; the real Tauri APIs are lazily imported.
 */

import { type InvokeFn, loadInvoke, loadSaveDialog } from "../user-asset-import";

export type CardExportResult = "written" | "cancelled";

export interface CardExportDeps {
  /** `@tauri-apps/plugin-dialog` save; resolves the picked path or null. */
  saveDialog(opts: {
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
}

async function defaultDeps(): Promise<CardExportDeps> {
  const [saveDialog, invoke] = await Promise.all([loadSaveDialog(), loadInvoke()]);
  return { saveDialog, invoke };
}

/** Path separators and control characters, the only characters a file stem may not carry. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is what is stripped.
const UNSAFE_FILE_CHARS = /[\x00-\x1f\x7f/\\]/g;

/** A file stem safe to hand the save dialog: separators and control chars out, `card` when nothing remains. */
export function sanitizeFileStem(name: string): string {
  return name.replace(UNSAFE_FILE_CHARS, "_").trim() || "card";
}

/** Save the card JSON through the OS save dialog and write it natively. */
export async function exportCardToFile(
  text: string,
  fileName: string,
  deps?: CardExportDeps,
): Promise<CardExportResult> {
  const d = deps ?? (await defaultDeps());
  const destPath = await d.saveDialog({
    defaultPath: fileName,
    filters: [{ name: "Card", extensions: ["json"] }],
  });
  if (destPath === null || destPath === "") return "cancelled";
  await d.invoke("write_card_file", { destPath, text });
  return "written";
}
