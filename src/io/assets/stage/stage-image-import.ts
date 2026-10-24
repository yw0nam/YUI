/**
 * Stage background image import: the Rust `import_stage_image` command (which opens the OS
 * picker itself), a decode check, then the store switches to the new image and the previous
 * file goes. Thin layer over the Rust `import_stage_image` / `remove_stage_image` commands;
 * deps are injectable so tests never touch a Tauri runtime.
 */

import { resolveUserFileSrc } from "../../../config/asset-url";
import { createLogger, type Logger } from "../../../logger";
import { type InvokeFn, loadInvoke, removeOrphanImport } from "../user-asset-import";
import { decodeImage } from "./decode-image";
import type { StageBackgroundStore } from "./stage-background";

export interface StageImportDeps {
  invoke: InvokeFn;
  /** The webview URL of a copied file; empty when the path is unusable. */
  resolveSrc(path: string): Promise<string>;
  decodeImage(url: string): Promise<void>;
  log: Logger;
}

interface ImportedStage {
  id: string;
  destPath: string;
}

async function defaultDeps(): Promise<StageImportDeps> {
  return {
    invoke: await loadInvoke(),
    resolveSrc: resolveUserFileSrc,
    decodeImage,
    log: createLogger("stage-image-import"),
  };
}

/**
 * Pick an image and make it the stage background. Resolves without change when the picker is
 * cancelled; rejects, leaving the store and the stage directory as they were, when the file is
 * not a usable image.
 */
export async function importStageImage(
  store: Pick<StageBackgroundStore, "get" | "setImage">,
  deps?: StageImportDeps,
): Promise<void> {
  const d = deps ?? (await defaultDeps());
  const imported = await d.invoke<ImportedStage | null>("import_stage_image");
  if (!imported) return;

  const remove = (id: string): Promise<void> => d.invoke("remove_stage_image", { id });
  const { id, destPath } = imported;
  try {
    const url = await d.resolveSrc(destPath);
    if (url === "") throw new Error("stage image url unavailable");
    await d.decodeImage(url);
  } catch (err) {
    await removeOrphanImport(id, remove, (e) =>
      d.log.warn("stage_image_cleanup_failed", { error: String(e) }),
    );
    throw err;
  }

  const previous = store.get().image;
  store.setImage({ id, path: destPath });
  if (previous && previous.id !== id) {
    await removeOrphanImport(previous.id, remove, (e) =>
      d.log.warn("stage_image_remove_failed", { error: String(e) }),
    );
  }
}
