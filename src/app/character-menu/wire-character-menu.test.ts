// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { wireCharacterMenu } from "./wire-character-menu";

type Deps = Parameters<typeof wireCharacterMenu>[0];

let stage: HTMLElement;
let overlay: HTMLElement;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  document.body.innerHTML = "";
  stage = document.createElement("div");
  overlay = document.createElement("div");
  document.body.append(stage, overlay);
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  vi.useRealTimers();
});

const STATE = {
  talk: false,
  rest: false,
  listen: false,
  bubble: false,
  unified: false,
  bodies: [
    { id: "yui", label: "Yui" },
    { id: "natsume", label: "Natsume" },
  ],
  body: "yui",
  voices: [],
  voice: "",
  pace: "normal" as const,
  waiting: 0,
};
const KNOBS = {
  hysteresis_margin_px: 12,
  poll_interval_ms: 50,
  debounce_samples: 2,
  alpha_threshold: 0.1,
};

// Her 400x600 window at logical 300,517 on a 2x monitor whose work area starts under a 25pt menu bar.
const OPEN = {
  type: "open",
  id: "main#1",
  kind: "main",
  name: "Yui",
  state: STATE,
  frame: { x: 300, y: 517, width: 400, height: 600 },
  workArea: { x: 0, y: 25, width: 1440, height: 875 },
  head: 150,
  nameTop: 90,
  chest: { x: 200, y: 260 },
  hitTest: KNOBS,
};

function wired() {
  const state = { ...STATE };
  const emitted: unknown[] = [];
  const setFrameLogical = vi.fn(async () => {});
  const setPositionLogical = vi.fn(async () => {});
  const locomotion = {
    hold: vi.fn(),
    abortTravel: vi.fn(async () => {}),
    frame: {
      frameWindow: () => ({
        outerPosition: async () => ({ x: 600, y: 1034 }),
        outerSize: async () => ({ width: 800, height: 1200 }),
        scaleFactor: async () => 2,
        setPositionLogical,
        setFrameLogical,
      }),
      listMonitors: async () => [
        {
          position: { x: 0, y: 0 },
          size: { width: 2880, height: 1800 },
          workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1750 } },
          scaleFactor: 2,
        },
      ],
    },
  };
  const actions = {
    talk: vi.fn(),
    rest: vi.fn(),
    listen: vi.fn(),
    settings: vi.fn(),
    body: vi.fn<(id: string) => void | Promise<void>>(),
    voice: vi.fn(),
    pace: vi.fn(),
    threads: vi.fn(),
    bubble: vi.fn(),
    unified: vi.fn(),
    reset: vi.fn(),
    turnOff: vi.fn(),
  };
  teardowns.push(
    wireCharacterMenu({
      stage,
      overlay,
      label: "main",
      kind: "main",
      name: () => "Yui",
      renderer: {
        getTapPoints: () => ({
          head: { x: 200, y: 150 },
          chest: { x: 200, y: 260 },
          hips: null,
          charHpx: 400,
        }),
        getSilhouetteBounds: () => ({ left: 120, top: 90, right: 280, bottom: 600 }),
      },
      locomotion: locomotion as unknown as Deps["locomotion"],
      hitTest: () => KNOBS,
      bridge: {
        emitCharacterMenu: (message: unknown) => void emitted.push(message),
        onCharacterMenu: () => () => {},
      } as unknown as Deps["bridge"],
      ports: { read: () => state, actions },
      isTauri: () => true,
    }),
  );
  const rightClick = () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    return event;
  };
  return {
    locomotion,
    emitted,
    rightClick,
    writes: [setFrameLogical, setPositionLogical],
  };
}

it("holds her on a right-click and asks the menu window to open beside her, writing no size of hers", async () => {
  const { locomotion, emitted, rightClick, writes } = wired();

  const event = rightClick();

  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(emitted).toEqual([OPEN]));
  expect(locomotion.hold).toHaveBeenCalledExactlyOnceWith("menu", true, {
    onAbort: expect.any(Function),
  });
  for (const write of writes) expect(write).not.toHaveBeenCalled();
});
