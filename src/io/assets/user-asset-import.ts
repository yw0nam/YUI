/**
 * Shared plumbing for the bring-your-own-asset imports (voice, VRM): the dialog result
 * shape both pickers normalize, the lazy Tauri loaders that keep the plugin and the core
 * API out of non-Tauri/test envs, and the orphan cleanup a failed import runs.
 */

import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";

/** Dialog open result shape (path string, array, or {path} per plugin version). */
export type OpenResult = string | string[] | { path: string } | null;

/** `@tauri-apps/api/core` invoke. */
export type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Normalize the dialog result to a single source path, or null if nothing chosen. */
export function pickedPath(result: OpenResult): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result.length > 0 ? result : null;
  if (Array.isArray(result)) return result.length > 0 ? result[0] : null;
  if (typeof result === "object" && typeof result.path === "string") return result.path;
  return null;
}

/** Lazily imported `@tauri-apps/plugin-dialog` open, narrowed to OpenResult. */
export async function loadOpenDialog(): Promise<(opts: OpenDialogOptions) => Promise<OpenResult>> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return (opts) => open(opts) as Promise<OpenResult>;
}

/** Lazily imported `@tauri-apps/api/core` invoke. */
export async function loadInvoke(): Promise<InvokeFn> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/**
 * Remove an orphaned imported file (voice or VRM) after a failed import. A failed removal is
 * surfaced via onError (never swallowed) so multi-MB orphans don't pile up
 * silently; the caller's primary error still rethrows.
 */
export async function removeOrphanImport(
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
