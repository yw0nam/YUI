/**
 * tauri-listen.test.ts — shared Tauri `listen` resolver.
 *
 * Locks:
 *  - off-Tauri (no __TAURI_INTERNALS__): resolveTauriListen() returns undefined.
 */

import { describe, expect, it } from "vitest";
import { resolveTauriListen } from "./tauri-listen";

describe("tauri-listen — resolveTauriListen", () => {
  it("returns undefined off-Tauri (no __TAURI_INTERNALS__)", async () => {
    expect((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__).toBeUndefined();
    await expect(resolveTauriListen()).resolves.toBeUndefined();
  });
});
