/** Tauri 런타임 여부 — withGlobalTauri 환경에서 항상 주입되는 내부 핸들로 판별. */
export function isTauri(): boolean {
  return !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
