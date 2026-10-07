import { afterEach, describe, expect, it, vi } from "vitest";

// Both loops only build under Tauri, so capture the deps their factories are handed
// and drive the host-loss callbacks directly.
const { createPercher, createWindowDropSource, createAvatarExecutor } = vi.hoisted(() => ({
  createPercher: vi.fn((_deps: Record<string, () => void>) => ({
    start: () => {},
    cancel: () => {},
    stop: () => {},
  })),
  createWindowDropSource: vi.fn((_deps: Record<string, () => void>) => ({
    start: async () => {},
    stop: () => {},
    notePickup: vi.fn(),
  })),
  createAvatarExecutor: vi.fn((_deps: Record<string, unknown>) => ({
    start: () => {},
    stop: () => {},
    noteUserDrag: () => {},
  })),
}));
vi.mock("../../ambient/locomotion/perch/percher", () => ({ createPercher }));
vi.mock("../../dispatcher/sources/gesture/window-drop/window-drop-source", () => ({
  createWindowDropSource,
}));
vi.mock("../../io/window/pet/window-resize-source", () => ({
  createWindowResizeSource: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock("../../io/bridge/inbox/avatar-executor", () => ({ createAvatarExecutor }));
vi.mock("../../io/bridge/inbox/avatar-rpc", () => ({
  onAvatarRpc: () => () => {},
  respondAvatarRpc: () => {},
}));
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

import { wirePercher } from "../../ambient/locomotion/perch/wire-perch";
import { wireWindowSources } from "./wire-window-sources";

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
      getFallConfig: () => ({}) as never,
      getMotionKind: () => undefined,
      isBusy: () => false,
      walker: { walkTo: async () => "arrived" as const, cancel: () => {} },
      sitter: {} as never,
      dropSource: {} as never,
      setHitTestMoving: () => {},
      onHostLost: () => faller.drop(),
      onTargetLost: () => faller.drop(),
      onStepOff: () => faller.drop(),
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
      onRelocated: async () => {},
      sitDown: async () => "done" as const,
      isHeld: () => false,
      log: noopLog,
    });
    await vi.waitFor(() => expect(createWindowDropSource).toHaveBeenCalled());

    createWindowDropSource.mock.calls[0][0].onSitLost();

    expect(faller.drop).toHaveBeenCalledTimes(1);
  });

  it("hands the avatar executor the relocate fall callback", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    createAvatarExecutor.mockClear();
    const onRelocated = vi.fn(async () => {});

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
      onDragMiss: () => {},
      onSitLost: () => {},
      onRelocated,
      sitDown: async () => "done" as const,
      isHeld: () => false,
      log: noopLog,
    });
    await vi.waitFor(() => expect(createAvatarExecutor).toHaveBeenCalled());

    expect(createAvatarExecutor.mock.calls[0][0].onRelocated).toBe(onRelocated);
  });
});

describe("drag start reaches the drop source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the pickup on the drop source when a user drag starts", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    createWindowDropSource.mockClear();

    const handle = wireWindowSources({
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
      onDragMiss: () => {},
      onSitLost: () => {},
      onRelocated: async () => {},
      sitDown: async () => "done" as const,
      isHeld: () => false,
      log: noopLog,
    });
    await vi.waitFor(() => expect(createWindowDropSource).toHaveBeenCalled());

    handle.noteUserDrag();

    expect(createWindowDropSource.mock.results[0].value.notePickup).toHaveBeenCalledTimes(1);
  });
});
