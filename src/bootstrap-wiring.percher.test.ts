import { afterEach, describe, expect, it, vi } from "vitest";

// wirePercher only builds the loop under Tauri, so capture the deps it hands createPercher
// and createJumper, and drive the cue callbacks directly.
const { createPercher, createJumper } = vi.hoisted(() => ({
  createPercher: vi.fn((_deps: Record<string, () => void>) => ({
    start: () => {},
    cancel: () => {},
    stop: () => {},
  })),
  createJumper: vi.fn((_deps: Record<string, () => void>) => ({
    jump: async () => "landed" as const,
    cancel: () => {},
  })),
}));
vi.mock("./ambient/percher", () => ({ createPercher }));
vi.mock("./ambient/jumper", () => ({ createJumper }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: vi.fn(() => ({})),
}));
vi.mock("@tauri-apps/api/dpi", () => ({ PhysicalPosition: class {} }));

import { wirePercher } from "./bootstrap-wiring";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

async function wire() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createPercher.mockClear();
  createJumper.mockClear();
  const pushed: Array<{ event_name: string; hint_tier?: number }> = [];
  const setHitTestMoving = vi.fn();
  const onTargetLost = vi.fn();
  wirePercher({
    bus: { push: (env: { event_name: string }) => pushed.push(env) } as never,
    renderer: {} as never,
    getPerchWalkConfig: () => ({}) as never,
    getJumpConfig: () => ({}) as never,
    getMotionKind: () => undefined,
    isBusy: () => false,
    walker: { walkTo: async () => "arrived" as const, cancel: () => {} },
    dropSource: {} as never,
    onHostLost: () => {},
    onTargetLost,
    setHitTestMoving,
    log: noopLog,
  });
  await vi.waitFor(() => expect(createPercher).toHaveBeenCalled());
  return {
    deps: createPercher.mock.calls[0][0],
    jumperDeps: createJumper.mock.calls[0][0],
    pushed,
    setHitTestMoving,
    onTargetLost,
  };
}

describe("wirePercher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ends the walk on a cancelled stroll, the same as on an arrival", async () => {
    const { deps, pushed, setHitTestMoving } = await wire();

    deps.onWalkCancel();

    expect(pushed.map((env) => env.event_name)).toEqual(["avatar.walk_end"]);
    expect(setHitTestMoving).toHaveBeenCalledWith(false);
  });

  it("drops the character when a jump loses the window it was aiming at", async () => {
    const { deps, pushed, onTargetLost } = await wire();

    deps.onTargetLost();

    expect(onTargetLost).toHaveBeenCalledTimes(1);
    expect(pushed).toEqual([]);
  });

  it("announces a takeoff as a tier-1 local avatar event", async () => {
    const { jumperDeps, pushed } = await wire();

    jumperDeps.onTakeoff();

    expect(pushed.map((env) => env.event_name)).toEqual(["avatar.jump"]);
    expect(pushed[0].hint_tier).toBe(1);
  });
});
