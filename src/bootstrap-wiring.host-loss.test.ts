import { afterEach, describe, expect, it, vi } from "vitest";

// Both loops only build under Tauri, so capture the deps their factories are handed
// and drive the host-loss callbacks directly.
const { createPercher, createWindowDropSource } = vi.hoisted(() => ({
  createPercher: vi.fn((_deps: Record<string, () => void>) => ({
    start: () => {},
    cancel: () => {},
    stop: () => {},
  })),
  createWindowDropSource: vi.fn((_deps: Record<string, () => void>) => ({
    start: async () => {},
    stop: () => {},
  })),
}));
vi.mock("./ambient/percher", () => ({ createPercher }));
vi.mock("./io/window-drop-source", () => ({ createWindowDropSource }));
vi.mock("./io/window-resize-source", () => ({
  createWindowResizeSource: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock("./io/avatar-executor", () => ({
  createAvatarExecutor: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock("./io/avatar-rpc", () => ({ onAvatarRpc: () => () => {}, respondAvatarRpc: () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: vi.fn(() => ({})),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {},
  LogicalSize: class {},
  PhysicalPosition: class {},
}));

import { wirePercher, wireWindowSources } from "./bootstrap-wiring";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("host loss reaches the faller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops the character when the percher's host window disappears", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    createPercher.mockClear();
    const faller = { drop: vi.fn() };

    wirePercher({
      bus: { push: () => {} } as never,
      renderer: {} as never,
      getPerchWalkConfig: () => ({}) as never,
      getJumpConfig: () => ({}) as never,
      getMotionKind: () => undefined,
      isBusy: () => false,
      walker: { walkTo: async () => "arrived" as const, cancel: () => {} },
      dropSource: {} as never,
      setHitTestMoving: () => {},
      onHostLost: () => faller.drop(),
      onTargetLost: () => faller.drop(),
      log: noopLog,
    });
    await vi.waitFor(() => expect(createPercher).toHaveBeenCalled());

    createPercher.mock.calls[0][0].onHostLost();

    expect(faller.drop).toHaveBeenCalledTimes(1);
  });

  it("drops the character when the armed sit's host window is lost", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    createWindowDropSource.mockClear();
    const faller = { drop: vi.fn() };

    wireWindowSources({
      bus: { push: () => {} } as never,
      renderer: {} as never,
      peekActive: () => false,
      getPeekConfig: () => ({}) as never,
      getGestureCues: () => ({}) as never,
      agentNotifySettings: { get: () => ({ enabled: false }) } as never,
      getPosture: () => ({}) as never,
      getVrm: () => null,
      noteAvatarMoved: () => {},
      noteAgentMove: () => {},
      onDragMiss: () => faller.drop(),
      onSitLost: () => faller.drop(),
      log: noopLog,
    });
    await vi.waitFor(() => expect(createWindowDropSource).toHaveBeenCalled());

    createWindowDropSource.mock.calls[0][0].onSitLost();

    expect(faller.drop).toHaveBeenCalledTimes(1);
  });
});
