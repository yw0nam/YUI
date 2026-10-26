/**
 * Card thumbnail file steps — the native retain/remove of a PNG card's copy under the
 * preset's id, and the file URL the UI renders. Deps are injectable so tests never
 * touch a real Tauri runtime; the real Tauri APIs are lazily imported.
 */

import { createLogger } from "../../../logger";
import { defaultCrop, type PhotoCrop } from "../../../settings/preset/photo-crop";
import { type InvokeFn, loadInvoke } from "../user-asset-import";
import { loadPhotoSize } from "./photo-size";

const log = createLogger("card-thumbnail");

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

/** Retains the thumbnail and frames it by default; the photo shows centred when its size cannot be read. */
export async function retainFramedThumbnail(
  tempId: string,
  presetId: string,
): Promise<{ url: string; crop?: PhotoCrop }> {
  const url = await retainCardThumbnail(tempId, presetId);
  try {
    return { url, crop: defaultCrop(await loadPhotoSize(url)) };
  } catch (error) {
    log.warn("photo_size_failed", { preset: presetId, error: String(error) });
    return { url };
  }
}

/** Delete a thumbnail file by temp id or preset id. Idempotent on the native side. */
export async function removeCardThumbnail(
  id: string,
  deps?: Pick<CardThumbnailDeps, "invoke">,
): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_card_thumbnail", { id });
}

/**
 * Open the photo picker for a preset and return the file URL of its new thumbnail; null when the
 * picker is dismissed. A second pick overwrites the same file, so the URL carries the pick's time
 * to read as a change to the registry and to the webview's image cache.
 */
export async function pickPresetPhoto(
  presetId: string,
  deps?: CardThumbnailDeps,
): Promise<string | null> {
  const d = deps ?? (await defaultDeps());
  const path = await d.invoke<string | null>("pick_preset_photo", { presetId });
  return path === null ? null : `${d.convertFileSrc(path)}?v=${Date.now()}`;
}
