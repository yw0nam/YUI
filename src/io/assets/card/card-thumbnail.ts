/**
 * Card thumbnail file steps — the native retain/remove of a PNG card's copy under the
 * preset's id, and the file URL the UI renders. Deps are injectable so tests never
 * touch a real Tauri runtime; the real Tauri APIs are lazily imported.
 */

import { type InvokeFn, loadInvoke } from "../user-asset-import";

export interface CardThumbnailDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
  /** `@tauri-apps/api/core` convertFileSrc. */
  convertFileSrc(path: string): string;
}

async function defaultDeps(): Promise<CardThumbnailDeps> {
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  return { invoke, convertFileSrc };
}

/** Rename `cards/<tempId>.png` to `cards/<presetId>.png` and return its file URL. */
export async function retainCardThumbnail(
  tempId: string,
  presetId: string,
  deps?: CardThumbnailDeps,
): Promise<string> {
  const d = deps ?? (await defaultDeps());
  const destPath = await d.invoke<string>("retain_card_thumbnail", { tempId, presetId });
  return d.convertFileSrc(destPath);
}

/** Delete a thumbnail file by temp id or preset id. Idempotent on the native side. */
export async function removeCardThumbnail(
  id: string,
  deps?: Pick<CardThumbnailDeps, "invoke">,
): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_card_thumbnail", { id });
}
