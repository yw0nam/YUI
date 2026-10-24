/**
 * Shared plumbing for the bring-your-own-asset imports (voice, VRM): the lazy Tauri loader
 * that keeps the core API out of non-Tauri/test envs, and the orphan cleanup a failed import
 * runs.
 */

/** `@tauri-apps/api/core` invoke. */
export type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

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
