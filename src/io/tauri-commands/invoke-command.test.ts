/**
 * invoke-command.test.ts — the facade's browser-dev path: no Tauri runtime, no core import.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { invokeCommand } from "./invoke-command";

describe("invokeCommand", () => {
  beforeEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("rejects off Tauri without loading the core API", async () => {
    await expect(invokeCommand("drag_window")).rejects.toThrow("tauri_unavailable");
    expect(invoke).not.toHaveBeenCalled();
  });
});
