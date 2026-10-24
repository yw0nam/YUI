/**
 * Bring-your-own-VRM import — the Rust `import_vrm_file` command (which opens the OS picker
 * itself) → native copy → user AvatarOption.
 *
 * Thin layer over the Rust `import_vrm_file` / `remove_user_vrm` commands. Deps are injectable
 * so tests never touch a real Tauri runtime; the real Tauri API is lazily imported
 * (non-Tauri/test envs never load it).
 */

import type { AvatarOption } from "../../config/validators/avatar/types";
import { loadInvoke } from "./user-asset-import";
import type { createVrmSelection } from "./vrm-selection";

export interface VrmImportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** `@tauri-apps/api/core` convertFileSrc. */
  convertFileSrc(path: string): string;
}

/** Only the bits removeUserVrm needs. */
type VrmRemoveDeps = Pick<VrmImportDeps, "invoke">;

async function defaultDeps(): Promise<VrmImportDeps> {
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  return { invoke, convertFileSrc };
}

interface ImportedVrm {
  id: string;
  destPath: string;
}

/**
 * Copy the file the Rust picker chose into app-data and return its AvatarOption
 * (source:"user"). Returns null when the picker was cancelled. The bundled ids are reserved,
 * so an imported file never takes one.
 */
export async function importVrmFromFile(
  selection: Pick<ReturnType<typeof createVrmSelection>, "list">,
  deps?: VrmImportDeps,
): Promise<AvatarOption | null> {
  const d = deps ?? (await defaultDeps());
  const reservedIds = selection
    .list()
    .filter((o) => o.source === "bundled")
    .map((o) => o.id);
  const imported = await d.invoke<ImportedVrm | null>("import_vrm_file", { reservedIds });
  if (!imported) return null;
  return {
    id: imported.id,
    label: imported.id,
    url: d.convertFileSrc(imported.destPath),
    source: "user",
  };
}

/** Delete an imported VRM's file from app-data. Idempotent on the native side. */
export async function removeUserVrm(id: string, deps?: VrmRemoveDeps): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_user_vrm", { id });
}
