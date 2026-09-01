import { afterEach, describe, expect, it, vi } from "vitest";

// wirePercher only builds the loop under Tauri, so capture the deps it hands createPercher
// and createJumper, and drive the cue callbacks directly.
const { createPercher, createJumper, landOn } = vi.hoisted(() => {
  const landOn = vi.fn();
  return {
    landOn,
    createPercher: vi.fn((_deps: Record<string, () => void>) => ({
      start: () => {},
      cancel: () => {},
      stop: () => {},
      landOn,
    })),
    createJumper: vi.fn((_deps: Record<string, () => void>) => ({
      jump: async () => "landed" as const,
      cancel: () => {},
    })),
  };
});
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
  landOn.mockClear();
  const pushed: Array<{ event_name: string; hint_tier?: number }> = [];
  const setHitTestMoving = vi.fn();
  const onTargetLost = vi.fn();
  const handle = wirePercher({
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
    handle,
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
    const { deps, pushed } = await wire();

    deps.onTakeoff();

    expect(pushed.map((env) => env.event_name)).toEqual(["avatar.jump"]);
    expect(pushed[0].hint_tier).toBe(1);
  });

  it("hands a window a fall came down on to the perch loop", async () => {
    const { handle } = await wire();
    const target = { windowNumber: 5, name: "Chat", ownerName: "Messages" };

    handle.landOn(target as never);

    expect(landOn).toHaveBeenCalledWith(target);
  });

  it("hands the jumper the readers it needs and no cue of its own", async () => {
    const { jumperDeps } = await wire();

    // The takeoff cue belongs to the percher, which abandons the old seat on the same beat.
    expect(Object.keys(jumperDeps).sort()).toEqual([
      "getConfig",
      "getWindow",
      "listWindows",
      "renderer",
    ]);
  });
});
