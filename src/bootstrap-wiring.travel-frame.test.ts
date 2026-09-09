import { afterEach, describe, expect, it, vi } from "vitest";

// wireTravelFrame only builds the real frame under Tauri, so capture the deps it hands
// createTravelFrame and drive the fake travel directly.
const { createTravelFrame, fakeTravel } = vi.hoisted(() => {
  const fakeTravel = {
    begin: vi.fn(
      async (_end: { x: number; y: number }, _via?: Array<{ x: number; y: number }>) => ({
        win: { sentinel: "virtual" },
        end: vi.fn(async () => {}),
      }),
    ),
    current: vi.fn(() => null as { sentinel: string } | null),
    abort: vi.fn(async () => {}),
  };
  return {
    fakeTravel,
    createTravelFrame: vi.fn((_deps: Record<string, unknown>) => fakeTravel),
  };
});
vi.mock("./io/travel-frame", () => ({ createTravelFrame }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: vi.fn(() => ({
    outerPosition: vi.fn(async () => ({ x: 1, y: 2 })),
    outerSize: vi.fn(async () => ({ width: 3, height: 4 })),
    scaleFactor: vi.fn(async () => 1),
    setPosition: vi.fn(async () => {}),
  })),
}));
vi.mock("@tauri-apps/api/dpi", () => ({ LogicalPosition: class {} }));

import { invoke } from "@tauri-apps/api/core";
import { wireTravelFrame } from "./bootstrap-wiring";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

async function wire() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createTravelFrame.mockClear();
  fakeTravel.begin.mockClear();
  fakeTravel.current.mockClear();
  fakeTravel.abort.mockClear();
  const setKeepOnScreenPaused = vi.fn();
  const handle = wireTravelFrame({
    renderer: {} as never,
    setKeepOnScreenPaused,
    log: noopLog,
  });
  await handle.ready;
  return { handle, setKeepOnScreenPaused };
}

describe("wireTravelFrame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the real frame's setFrameLogical over the set_frame_logical command", async () => {
    await wire();
    const frame = createTravelFrame.mock.calls[0][0].frame as {
      setFrameLogical(x: number, y: number, width: number, height: number): Promise<void>;
    };

    await frame.setFrameLogical(10, 20, 400, 600);

    expect(invoke).toHaveBeenCalledWith("set_frame_logical", {
      x: 10,
      y: 20,
      width: 400,
      height: 600,
    });
  });

  it("passes setKeepOnScreenPaused straight through to createTravelFrame", async () => {
    const { setKeepOnScreenPaused } = await wire();
    const deps = createTravelFrame.mock.calls[0][0] as {
      setKeepOnScreenPaused: (paused: boolean) => void;
    };

    deps.setKeepOnScreenPaused(true);

    expect(setKeepOnScreenPaused).toHaveBeenCalledWith(true);
  });

  it("getWindow falls back to the real window while no travel is current", async () => {
    const { handle } = await wire();
    fakeTravel.current.mockReturnValue(null);

    const win = handle.getWindow();

    await expect(win.outerPosition()).resolves.toEqual({ x: 1, y: 2 });
  });

  it("getWindow returns the virtual window while a travel is current", async () => {
    const { handle } = await wire();
    fakeTravel.current.mockReturnValue({ sentinel: "virtual" });

    expect(handle.getWindow()).toEqual({ sentinel: "virtual" });
  });

  it("delegates travel.begin to the underlying travel frame", async () => {
    const { handle } = await wire();

    await handle.travel.begin({ x: 5, y: 6 });

    expect(fakeTravel.begin).toHaveBeenCalledWith({ x: 5, y: 6 }, undefined);
  });

  it("delegates travel.begin's via points to the underlying travel frame", async () => {
    const { handle } = await wire();

    await handle.travel.begin({ x: 5, y: 6 }, [{ x: 7, y: 8 }]);

    expect(fakeTravel.begin).toHaveBeenCalledWith({ x: 5, y: 6 }, [{ x: 7, y: 8 }]);
  });

  it("delegates abort() to the underlying travel frame", async () => {
    const { handle } = await wire();

    await handle.abort();

    expect(fakeTravel.abort).toHaveBeenCalledTimes(1);
  });

  it("abort() resolves even before the real frame is wired", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const handle = wireTravelFrame({
      renderer: {} as never,
      setKeepOnScreenPaused: vi.fn(),
      log: noopLog,
    });

    await expect(handle.abort()).resolves.toBeUndefined();
  });

  it("resolves ready even when disposed before the dynamic imports settle", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const handle = wireTravelFrame({
      renderer: {} as never,
      setKeepOnScreenPaused: vi.fn(),
      log: noopLog,
    });
    handle.dispose();

    await expect(handle.ready).resolves.toBeUndefined();
  });
});
