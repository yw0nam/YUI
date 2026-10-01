/**
 * Stage background image import: OS image picker, native copy into app data, a decode check, then
 * the store switches to the new image and the previous file goes. Thin layer over the dialog
 * plugin and the Rust `import_stage_image` / `remove_stage_image` commands; deps are injectable
 * so tests never touch a Tauri runtime.
 */

import { resolveUserFileSrc } from "../../../config/asset-url";
import { createLogger, type Logger } from "../../../logger";
import {
  type InvokeFn,
  loadInvoke,
  loadOpenDialog,
  type OpenResult,
  pickedPath,
  removeOrphanImport,
} from "../user-asset-import";
import { decodeImage } from "./decode-image";
import type { StageBackgroundStore } from "./stage-background";

export interface StageImportDeps {
  openDialog(opts: {
    multiple: boolean;
    directory: boolean;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenResult>;
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
  const [openDialog, invoke] = await Promise.all([loadOpenDialog(), loadInvoke()]);
  return {
    openDialog,
    invoke,
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
  const picked = pickedPath(
    await d.openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    }),
  );
  if (picked === null) return;

  const remove = (id: string): Promise<void> => d.invoke("remove_stage_image", { id });
  const { id, destPath } = await d.invoke<ImportedStage>("import_stage_image", { srcPath: picked });
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
