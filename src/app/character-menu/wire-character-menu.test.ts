// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setFocus: vi.fn(async () => {}) }));
vi.mock("../../tauri-env", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: mocks.setFocus }),
}));
vi.mock("../../ui/character-menu/character-menu.css", () => ({}));

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
  from: "main",
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
  let state = { ...STATE };
  let deliver: (message: unknown) => void = () => {};
  const emitted: unknown[] = [];
  const setFrameLogical = vi.fn(async () => {});
  const setPositionLogical = vi.fn(async () => {});
  const locomotion = {
    hold: vi.fn(),
    abortTravel: vi.fn(async () => {}),
    widen: vi.fn(),
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
        onCharacterMenu: (cb: (message: never) => void) => {
          deliver = cb as (message: unknown) => void;
          return () => {
            deliver = () => {};
          };
        },
      } as unknown as Deps["bridge"],
      ports: { read: () => state, actions },
    }),
  );
  const rightClick = () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    return event;
  };
  const onAbort = () =>
    (locomotion.hold.mock.calls[0]?.[2] as { onAbort: () => void | Promise<void> }).onAbort();
  const setState = (next: typeof STATE) => {
    state = next;
  };
  return {
    locomotion,
    actions,
    emitted,
    rightClick,
    onAbort,
    setState,
    deliver: (message: unknown) => deliver(message),
    writes: [setFrameLogical, setPositionLogical, locomotion.widen],
  };
}

const marked = () => overlay.hasAttribute("data-menu-open");

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

it("sends nothing for a right-click while her menu is pending or shown", async () => {
  const { emitted, rightClick, deliver } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  rightClick();
  await Promise.resolve();
  deliver({ type: "shown", id: "main#1" });
  rightClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(emitted).toEqual([OPEN]);
});

it.each([
  [true, 1],
  [false, 0],
])("marks the overlay while the menu shows, and a closed with refocus %s clears it, lets her go and focuses her window %i times", async (refocus, focuses) => {
  const { locomotion, emitted, rightClick, deliver, writes } = wired();
  mocks.setFocus.mockClear();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  deliver({ type: "shown", id: "main#1" });
  const shown = marked();
  deliver({ type: "closed", id: "main#1", refocus });

  await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledTimes(focuses));
  expect([shown, marked()]).toEqual([true, false]);
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
  for (const write of writes) expect(write).not.toHaveBeenCalled();
});

it("ignores a closed report for another open", async () => {
  const { locomotion, emitted, rightClick, deliver } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  deliver({ type: "shown", id: "main#1" });

  deliver({ type: "closed", id: "pet-mio#1", refocus: true });

  expect([marked(), locomotion.hold.mock.calls]).toEqual([
    true,
    [["menu", true, { onAbort: expect.any(Function) }]],
  ]);
});

it("runs a picked action and sends the state it left once the port settles", async () => {
  const { actions, emitted, rightClick, deliver, setState } = wired();
  let swapped: () => void = () => {};
  actions.body.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        swapped = () => {
          setState({ ...STATE, body: "natsume" });
          resolve();
        };
      }),
  );
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  deliver({ type: "shown", id: "main#1" });

  deliver({ type: "action", id: "main#1", action: "body", value: "natsume" });
  await Promise.resolve();
  const before = emitted.length;
  swapped();

  await vi.waitFor(() => expect(emitted).toHaveLength(2));
  expect(actions.body).toHaveBeenCalledExactlyOnceWith("natsume");
  expect([before, emitted[1]]).toEqual([
    1,
    { type: "state", id: "main#1", state: { ...STATE, body: "natsume" } },
  ]);
});

it("closes the menu for an agent move, which goes on once the menu reports closed", async () => {
  const { locomotion, emitted, rightClick, deliver, onAbort } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  deliver({ type: "shown", id: "main#1" });
  let settled = false;

  const aborting = Promise.resolve(onAbort()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  const before = settled;
  deliver({ type: "closed", id: "main#1", refocus: false });
  await aborting;

  expect([before, emitted[1]]).toEqual([false, { type: "close", id: "main#1" }]);
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
});

it("sends no open when an agent move takes her during the geometry reads, and the next right-click opens", async () => {
  const { locomotion, emitted, rightClick, onAbort } = wired();
  let travelEnded: () => void = () => {};
  locomotion.abortTravel.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        travelEnded = resolve;
      }),
  );
  rightClick();
  await vi.waitFor(() => expect(locomotion.hold).toHaveBeenCalledTimes(1));

  await onAbort();
  travelEnded();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const released = locomotion.hold.mock.calls.at(-1);
  rightClick();

  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  expect([released, emitted]).toEqual([["menu", false], [{ ...OPEN, id: "main#2" }]]);
});

it("lets her go when the menu window does not answer in 2 s, and closes a late shown", async () => {
  vi.useFakeTimers();
  const { locomotion, emitted, rightClick, deliver } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  await vi.advanceTimersByTimeAsync(2000);
  const released = locomotion.hold.mock.calls.at(-1);
  deliver({ type: "shown", id: "main#1" });

  expect([released, marked(), emitted]).toEqual([
    ["menu", false],
    false,
    [OPEN, { type: "close", id: "main#1" }],
  ]);
});
