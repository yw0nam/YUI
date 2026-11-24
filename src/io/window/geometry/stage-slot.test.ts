// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  innerPosition: vi.fn<() => Promise<{ x: number; y: number }>>(),
  innerSize: vi.fn<() => Promise<{ width: number; height: number }>>(),
  scaleFactor: vi.fn<() => Promise<number>>(),
  isMinimized: vi.fn<() => Promise<boolean>>(),
  onMoved: vi.fn<(cb: () => void) => Promise<() => void>>(),
  onResized: vi.fn<(cb: () => void) => Promise<() => void>>(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));

import { sendStageSlot } from "./stage-slot";

let stage: HTMLElement;
let moved: () => void;
let ask: () => void;
const emitSettingsStage = vi.fn();
const teardowns: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  // Her content origin at (200, 150) pt on a scale-2 display.
  win.innerPosition.mockResolvedValue({ x: 400, y: 300 });
  // A 680 pt tall page that fills the inner size: no title bar inside it.
  vi.stubGlobal("innerHeight", 680);
  win.innerSize.mockResolvedValue({ width: 2320, height: 1360 });
  win.scaleFactor.mockResolvedValue(2);
  win.isMinimized.mockResolvedValue(false);
  win.onMoved.mockImplementation(async (cb) => {
    moved = cb;
    return () => {};
  });
  win.onResized.mockResolvedValue(() => {});
  stage = document.createElement("div");
  stage.style.paddingTop = "600px";
  stage.getBoundingClientRect = () => ({ left: 8, top: 0, width: 400 }) as DOMRect;
  document.body.append(stage);
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function wire(boundId: string | null = null) {
  teardowns.push(
    sendStageSlot({
      emit: emitSettingsStage,
      onAsk: (cb) => {
        ask = cb;
        return () => {};
      },
      preset: boundId,
      stage,
    }),
  );
}

const slot = { x: 208, y: 150, width: 400, height: 600, scale: 2 };

it("sends the stage's top slot in screen points at boot, with the window's scale", async () => {
  wire();

  await vi.waitFor(() =>
    expect(emitSettingsStage).toHaveBeenCalledExactlyOnceWith({ preset: null, slot: slot }),
  );
});

it("moves the slot below a title bar the inner size holds above the page", async () => {
  // macOS: the inner size is 712 pt tall over a 680 pt page, so the page starts 32 pt lower.
  win.innerSize.mockResolvedValue({ width: 2320, height: 1424 });

  wire();

  await vi.waitFor(() =>
    expect(emitSettingsStage).toHaveBeenCalledExactlyOnceWith({
      preset: null,
      slot: { ...slot, y: 182 },
    }),
  );
});

it("sends no slot while the window is minimised", async () => {
  win.isMinimized.mockResolvedValue(true);

  wire("mio");

  await vi.waitFor(() =>
    expect(emitSettingsStage).toHaveBeenCalledExactlyOnceWith({ preset: "mio", slot: null }),
  );
});

it("sends a moved slot, skips an unchanged one, and answers every ask", async () => {
  wire();
  await vi.waitFor(() => expect(emitSettingsStage).toHaveBeenCalledOnce());

  moved();
  await new Promise((resolve) => setTimeout(resolve, 0));
  win.innerPosition.mockResolvedValue({ x: 600, y: 300 });
  moved();
  await vi.waitFor(() => expect(emitSettingsStage).toHaveBeenCalledTimes(2));
  ask();

  await vi.waitFor(() => expect(emitSettingsStage).toHaveBeenCalledTimes(3));
  expect(emitSettingsStage.mock.calls.slice(1)).toEqual([
    [{ preset: null, slot: { ...slot, x: 308 } }],
    [{ preset: null, slot: { ...slot, x: 308 } }],
  ]);
});

it("drops a slot read that a minimise overtook", async () => {
  let readDone!: (pos: { x: number; y: number }) => void;
  win.innerPosition.mockReturnValueOnce(
    new Promise((resolve) => {
      readDone = resolve;
    }),
  );
  wire();
  await vi.waitFor(() => expect(win.innerPosition).toHaveBeenCalledOnce());

  win.isMinimized.mockResolvedValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  readDone({ x: 400, y: 300 });

  await vi.waitFor(() => expect(emitSettingsStage).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(emitSettingsStage.mock.calls).toEqual([[{ preset: null, slot: null }]]);
});
