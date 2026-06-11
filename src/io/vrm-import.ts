/**
 * Bring-your-own-VRM import — OS file picker → native copy → user AvatarOption.
 *
 * Thin layer over the dialog plugin + the Rust `import_vrm_file` / `remove_user_vrm`
 * commands. Deps are injectable so tests never touch a real Tauri runtime; the real
 * Tauri APIs are lazily imported (non-Tauri/test envs never load them).
 */

import type { AvatarOption } from "../config/load";

/** Dialog open result shape (path string, array, or {path} per plugin version). */
type OpenResult = string | string[] | { path: string } | null;

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
export type VrmRemoveDeps = Pick<VrmImportDeps, "invoke">;

async function defaultDeps(): Promise<VrmImportDeps> {
  const [{ open }, { invoke, convertFileSrc }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  return {
    openDialog: (opts) => open(opts) as Promise<OpenResult>,
    invoke,
    convertFileSrc,
  };
}

async function defaultRemoveDeps(): Promise<VrmRemoveDeps> {
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

/** Normalize the dialog result to a single source path, or null if nothing chosen. */
function pickedPath(result: OpenResult): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result.length > 0 ? result : null;
  if (Array.isArray(result)) return result.length > 0 ? result[0] : null;
  if (typeof result === "object" && typeof result.path === "string") return result.path;
  return null;
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
  const d = deps ?? (await defaultRemoveDeps());
  await d.invoke("remove_user_vrm", { id });
}

/**
 * Remove an orphaned imported VRM after a failed import. A failed removal is
 * surfaced via onError (never swallowed) so multi-MB orphans don't pile up
 * silently; the caller's primary error still rethrows.
 */
export async function removeOrphanVrm(
  id: string,
  remove: (id: string) => Promise<void>,
  onError: (err: unknown) => void,
): Promise<void> {
  try {
    await remove(id);
  } catch (err) {
    onError(err);
  }
}
