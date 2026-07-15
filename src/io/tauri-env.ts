/** Whether we're in the Tauri runtime — detected via the internal handle always injected under withGlobalTauri. */
export function isTauri(): boolean {
  return !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
