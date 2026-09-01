import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowRect } from "./contract";

// wireFaller only builds the loop under Tauri, so capture the deps it hands createFaller
// and drive the landing callback directly.
const { createFaller } = vi.hoisted(() => ({
  createFaller: vi.fn((_deps: Record<string, (arg: never) => void>) => ({
    drop: async () => {},
    cancel: () => {},
    stop: () => {},
  })),
}));
vi.mock("./ambient/faller", () => ({ createFaller }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: vi.fn(() => ({})),
}));
vi.mock("@tauri-apps/api/dpi", () => ({ PhysicalPosition: class {} }));

import { wireFaller } from "./bootstrap-wiring";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

const TARGET: WindowRect = {
  x: 400,
  y: 1100,
  width: 600,
  height: 400,
  name: "Chat",
  ownerName: "Messages",
  pid: 11,
  windowNumber: 5,
};

async function wire() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createFaller.mockClear();
  const pushed: Array<{ event_name: string; payload?: Record<string, unknown> }> = [];
  const onWindowLand = vi.fn();
  wireFaller({
    bus: { push: (env: { event_name: string }) => pushed.push(env) } as never,
    renderer: {} as never,
    getFallConfig: () => ({}) as never,
    getMotionKind: () => undefined,
    getFloorTolerancePx: () => 24,
    getGestureCues: () => ({ dropped: { label: "dropped from mid-air" } }) as never,
    setHitTestMoving: () => {},
    onWindowLand,
    log: noopLog,
  });
  await vi.waitFor(() => expect(createFaller).toHaveBeenCalled());
  return {
    deps: createFaller.mock.calls[0][0] as unknown as {
      onLand(landing: { heightPx: number; surface: unknown }): void;
    },
    pushed,
    onWindowLand,
  };
}

describe("wireFaller — landing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names no window on a landing that reached the floor", async () => {
    const { deps, pushed, onWindowLand } = await wire();

    deps.onLand({ heightPx: 780.4, surface: { kind: "floor", y: 1500 } });

    expect(pushed).toEqual([
      expect.objectContaining({
        event_name: "user.fall_land",
        payload: { height_px: 780, landed_on: "floor", app: null, window_title: null },
      }),
    ]);
    expect(onWindowLand).not.toHaveBeenCalled();
  });

  it("names the window a landing came down on and hands it to the perch loop", async () => {
    const { deps, pushed, onWindowLand } = await wire();

    deps.onLand({ heightPx: 380, surface: { kind: "window", y: 1100, target: TARGET } });

    expect(pushed).toEqual([
      expect.objectContaining({
        event_name: "user.fall_land",
        payload: {
          height_px: 380,
          landed_on: "window",
          app: "Messages",
          window_title: "Chat",
        },
      }),
    ]);
    expect(onWindowLand).toHaveBeenCalledWith(TARGET);
  });
});
