// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The wiring reaches isOverInteractive and the cursor only as factory options — mock the factories
// to capture the options they are created with and to stand in for the controllers.
const { createHitTestController, createCursorSource } = vi.hoisted(() => ({
  createHitTestController:
    vi.fn<typeof import("../../io/window/pet/hit-test").createHitTestController>(),
  createCursorSource:
    vi.fn<typeof import("../../io/window/pet/cursor-source").createCursorSource>(),
}));

vi.mock("../../io/window/pet/hit-test", () => ({ createHitTestController }));
vi.mock("../../io/window/pet/cursor-source", () => ({ createCursorSource }));

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../../ui/surfaces/interactive-overlay";
import { wireCursorStage } from "./wire-stage";

const rectOf = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({ left, top, right, bottom }) as DOMRect;

const knobs = (): HitTestKnobs => ({
  hysteresis_margin_px: 10,
  poll_interval_ms: 50,
  debounce_samples: 2,
  alpha_threshold: 0.5,
});

type Cursor = { x: number; y: number } | null;

const setup = (opts: {
  hit?: (x: number, y: number) => boolean;
  overlays?: Record<string, DOMRect[]>;
  gazeEnabled?: boolean;
}) => {
  const controller = {
    start: vi.fn(),
    stop: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    setMoving: vi.fn(),
  };
  createHitTestController.mockImplementation(() => controller);
  const listeners = new Set<(pos: Cursor) => void>();
  const cursor = {
    subscribe: vi.fn((listener: (pos: Cursor) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    setMoving: vi.fn(),
  };
  createCursorSource.mockImplementation(() => cursor);
  const querySelectorAll = vi.fn((selector: string) =>
    (opts.overlays?.[selector] ?? []).map(
      (rect) => ({ getBoundingClientRect: () => rect }) as unknown as HTMLElement,
    ),
  );
  const setGazeEnabled = vi.fn();
  const setGazeCursor = vi.fn();
  const settingsSubscribers = new Set<(state: { enabled: boolean }) => void>();
  let enabled = opts.gazeEnabled ?? false;
  const teardowns: Array<() => void> = [];
  const hitTest = wireCursorStage({
    root: { querySelectorAll } as unknown as HTMLElement,
    renderer: { hitTest: opts.hit ?? (() => false), setGazeEnabled, setGazeCursor },
    getConfig: knobs,
    gazeSettings: {
      get: () => ({ enabled }),
      subscribe: (cb) => {
        settingsSubscribers.add(cb);
        return () => void settingsSubscribers.delete(cb);
      },
    },
    register: (teardown) => void teardowns.push(teardown),
  });
  return {
    hitTest,
    controller,
    cursor,
    listeners,
    querySelectorAll,
    setGazeEnabled,
    setGazeCursor,
    settingsSubscribers,
    teardown: () => {
      for (const t of teardowns) t();
    },
    setEnabled: (next: boolean) => {
      enabled = next;
      for (const cb of settingsSubscribers) cb({ enabled: next });
    },
    isOverInteractive: createHitTestController.mock.calls[0][0].isOverInteractive,
  };
};

describe("wireCursorStage — hit-test", () => {
  it("counts a point on the character as interactive without any rect lookup", () => {
    const s = setup({ hit: () => true });
    expect(s.isOverInteractive(50, 60, 10)).toBe(true);
    expect(s.querySelectorAll).not.toHaveBeenCalled();
  });

  it("counts a point inside an overlay's margin and rejects one outside it", () => {
    const s = setup({
      overlays: { [INTERACTIVE_OVERLAY_SELECTORS[0]]: [rectOf(100, 100, 200, 140)] },
    });
    expect(s.isOverInteractive(95, 120, 10)).toBe(true);
    expect(s.isOverInteractive(85, 120, 10)).toBe(false);
  });

  // One selector can name several targets, such as the bubble's two edge buttons.
  it("counts every element a selector matches, not only the first", () => {
    const s = setup({
      overlays: {
        [INTERACTIVE_OVERLAY_SELECTORS[0]]: [
          rectOf(100, 100, 120, 120),
          rectOf(130, 100, 150, 120),
        ],
      },
    });
    expect(s.isOverInteractive(140, 110, 0)).toBe(true);
  });

  it("starts the controller on the shared cursor polled at hit_test.poll_interval_ms, and returns it", () => {
    const s = setup({});
    expect(s.controller.start).toHaveBeenCalledTimes(1);
    expect(s.hitTest).toBe(s.controller);
    const opts = createHitTestController.mock.calls[0][0];
    expect(opts.moveTarget).toBe(window);
    expect(opts.cursor).toBe(s.cursor);
    expect(createCursorSource.mock.calls[0][0].getIntervalMs()).toBe(50);
    s.teardown();
    expect(s.controller.stop).toHaveBeenCalledTimes(1);
  });
});

describe("wireCursorStage — gaze", () => {
  it("subscribes the gaze cursor while gaze is on and clears it when turned off", () => {
    const s = setup({ gazeEnabled: true });
    expect(s.setGazeEnabled).toHaveBeenCalledWith(true);
    expect(s.listeners.size).toBe(1);
    for (const listener of s.listeners) listener({ x: 3, y: 4 });
    expect(s.setGazeCursor).toHaveBeenCalledWith({ x: 3, y: 4 });

    s.setEnabled(false);
    expect(s.listeners.size).toBe(0);
    expect(s.setGazeEnabled).toHaveBeenLastCalledWith(false);
    expect(s.setGazeCursor).toHaveBeenLastCalledWith(null);

    s.setEnabled(true);
    expect(s.listeners.size).toBe(1);
  });

  it("teardown releases the gaze subscription and the settings subscription", () => {
    const s = setup({ gazeEnabled: true });
    s.teardown();
    expect(s.listeners.size).toBe(0);
    expect(s.settingsSubscribers.size).toBe(0);
  });
});
