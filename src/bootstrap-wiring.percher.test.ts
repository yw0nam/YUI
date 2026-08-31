import { afterEach, describe, expect, it, vi } from "vitest";

// wirePercher only builds the loop under Tauri, so capture the deps it hands createPercher
// and drive the cue callbacks directly.
const { createPercher } = vi.hoisted(() => ({
  createPercher: vi.fn((_deps: Record<string, () => void>) => ({
    start: () => {},
    cancel: () => {},
    stop: () => {},
  })),
}));
vi.mock("./ambient/percher", () => ({ createPercher }));
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
  const pushed: Array<{ event_name: string }> = [];
  const setHitTestMoving = vi.fn();
  wirePercher({
    bus: { push: (env: { event_name: string }) => pushed.push(env) } as never,
    renderer: {} as never,
    getPerchWalkConfig: () => ({}) as never,
    getMotionKind: () => undefined,
    isBusy: () => false,
    walker: { walkTo: async () => "arrived" as const, cancel: () => {} },
    dropSource: {} as never,
    onHostLost: () => {},
    setHitTestMoving,
    log: noopLog,
  });
  await vi.waitFor(() => expect(createPercher).toHaveBeenCalled());
  return { deps: createPercher.mock.calls[0][0], pushed, setHitTestMoving };
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
});
