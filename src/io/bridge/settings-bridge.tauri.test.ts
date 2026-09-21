// Inside Tauri, one bridge's emits reach Tauri one at a time, in send order.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { log, tauriEmit } = vi.hoisted(() => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tauriEmit: vi.fn(async (_name: string, _payload?: unknown) => {}),
}));
vi.mock("../../logger", () => ({ createLogger: () => log }));
vi.mock("../../tauri-env", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ emit: tauriEmit }));

import { createSettingsBridge } from "./settings-bridge";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createSettingsBridge — Tauri transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the next Tauri emit only after the previous one resolves", async () => {
    const first = deferred();
    tauriEmit.mockReturnValueOnce(first.promise);
    const bridge = createSettingsBridge(undefined, { windowKind: "pet" });

    bridge.emitVoiceSet(true);
    bridge.emitVoiceSet(false);
    await vi.waitFor(() => expect(tauriEmit).toHaveBeenCalled());
    await settle();
    expect(tauriEmit).toHaveBeenCalledTimes(1);
    expect(tauriEmit).toHaveBeenLastCalledWith(
      "yui://voice-set",
      expect.objectContaining({ payload: true }),
    );

    first.resolve();
    await vi.waitFor(() => expect(tauriEmit).toHaveBeenCalledTimes(2));
    expect(tauriEmit).toHaveBeenLastCalledWith(
      "yui://voice-set",
      expect.objectContaining({ payload: false }),
    );
  });

  it("logs a rejected Tauri emit and then starts the next one", async () => {
    const first = deferred();
    tauriEmit.mockReturnValueOnce(first.promise);
    const bridge = createSettingsBridge(undefined, { windowKind: "pet" });

    bridge.emitVoiceSet(true);
    bridge.emitVoiceSet(false);
    await vi.waitFor(() => expect(tauriEmit).toHaveBeenCalled());
    await settle();
    expect(tauriEmit).toHaveBeenCalledTimes(1);

    first.reject(new Error("ipc down"));
    await vi.waitFor(() => expect(tauriEmit).toHaveBeenCalledTimes(2));
    expect(log.warn).toHaveBeenCalledWith("tauri_emit_failed", { error: "Error: ipc down" });
    const failedAt = log.warn.mock.calls.findIndex(([k]) => k === "tauri_emit_failed");
    expect(log.warn.mock.invocationCallOrder[failedAt]).toBeLessThan(
      tauriEmit.mock.invocationCallOrder[1],
    );
    expect(tauriEmit).toHaveBeenLastCalledWith(
      "yui://voice-set",
      expect.objectContaining({ payload: false }),
    );
  });
});
