/**
 * Bring-your-own-VRM import — OS file picker → native copy → user AvatarOption.
 *
 * Thin layer over the dialog plugin + the Rust `import_vrm_file` / `remove_user_vrm`
 * commands. Deps are injectable so tests never touch a real Tauri runtime; the real
 * Tauri APIs are lazily imported (non-Tauri/test envs never load them).
 */

import type { AvatarOption } from "../config/load";
import { loadInvoke, loadOpenDialog, type OpenResult, pickedPath } from "./user-asset-import";

export interface VrmImportDeps {
  /** `@tauri-apps/plugin-dialog` open. */
  openDialog(opts: {
    multiple: boolean;
    directory: boolean;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenResult>;
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** `@tauri-apps/api/core` convertFileSrc. */
  convertFileSrc(path: string): string;
}

/** Only the bits removeUserVrm needs. */
type VrmRemoveDeps = Pick<VrmImportDeps, "invoke">;

async function defaultDeps(): Promise<VrmImportDeps> {
  const [openDialog, { invoke, convertFileSrc }] = await Promise.all([
    loadOpenDialog(),
    import("@tauri-apps/api/core"),
  ]);
  return { openDialog, invoke, convertFileSrc };
}

interface ImportedVrm {
  id: string;
  destPath: string;
}

/**
 * Open the VRM picker, copy the chosen file into app-data, and return its
 * AvatarOption (source:"user"). Returns null when the picker is cancelled.
 */
export async function importVrmFromFile(deps?: VrmImportDeps): Promise<AvatarOption | null> {
  const d = deps ?? (await defaultDeps());
  const result = await d.openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "VRM", extensions: ["vrm"] }],
  });

  const srcPath = pickedPath(result);
  if (srcPath === null) return null;

  const { id, destPath } = await d.invoke<ImportedVrm>("import_vrm_file", { srcPath });
  return { id, label: id, url: d.convertFileSrc(destPath), source: "user" };
}

/** Delete an imported VRM's file from app-data. Idempotent on the native side. */
export async function removeUserVrm(id: string, deps?: VrmRemoveDeps): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_user_vrm", { id });
}
