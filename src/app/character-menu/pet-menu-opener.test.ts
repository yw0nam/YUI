// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CharacterMenu } from "../../io/bridge/settings-bridge";
import { createPetMenuOpener } from "./pet-menu-opener";

let overlay: HTMLElement;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  document.body.innerHTML = "";
  overlay = document.createElement("div");
  document.body.append(overlay);
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  vi.useRealTimers();
});

const STATE = {
  talk: false,
  rest: null,
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
  let state: Omit<typeof STATE, "rest"> & { rest: unknown } = { ...STATE };
  const restListeners = new Set<() => void>();
  const emitted: unknown[] = [];
  const focusWindow = vi.fn(async () => {});
  const locomotion = {
    hold: vi.fn(),
    abortTravel: vi.fn(async () => {}),
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
  const opener = createPetMenuOpener({
    label: "main",
    kind: "main",
    name: () => "Yui",
    hitTest: () => KNOBS,
    overlay,
    locomotion,
    readPlacement: async () => ({
      frame: OPEN.frame,
      workArea: OPEN.workArea,
      head: OPEN.head,
      nameTop: OPEN.nameTop,
      chest: OPEN.chest,
    }),
    ports: { read: () => state as typeof STATE, actions },
    subscribeRest: (cb: () => void) => {
      restListeners.add(cb);
      return () => restListeners.delete(cb);
    },
    emit: (message) => void emitted.push(message),
    focusWindow,
  } as Parameters<typeof createPetMenuOpener>[0]);
  teardowns.push(opener.dispose);
  const rightClick = () => void opener.open();
  const onAbort = () =>
    (locomotion.hold.mock.calls[0]?.[2] as { onAbort: () => void | Promise<void> }).onAbort();
  const setState = (next: typeof state) => {
    state = next;
  };
  const restChanged = () => {
    for (const cb of restListeners) cb();
  };
  return {
    locomotion,
    actions,
    emitted,
    rightClick,
    onAbort,
    setState,
    restChanged,
    focusWindow,
    deliver: (message: unknown) => opener.receive(message as CharacterMenu),
  };
}

const marked = () => overlay.hasAttribute("data-menu-open");

it("asks nothing more while her menu is pending or shown", async () => {
  const { emitted, rightClick, deliver } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  rightClick();
  await Promise.resolve();
  deliver({ type: "shown", id: "main#1" });
  rightClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(emitted.filter((m) => (m as { type: string }).type === "open")).toEqual([OPEN]);
});

it("sends a fresh state once the menu reports shown", async () => {
  const { emitted, rightClick, deliver, setState } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  const rest = { kind: "rest", choice: "hour", startedAt: 1, endsAt: 3_600_001 };
  setState({ ...STATE, rest });

  deliver({ type: "shown", id: "main#1" });

  expect(emitted.slice(1)).toEqual([{ type: "state", id: "main#1", state: { ...STATE, rest } }]);
});

it("sends the state on each Rest change while the menu shows, and none before or after", async () => {
  const { emitted, rightClick, deliver, restChanged } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));
  restChanged();
  const pending = emitted.length;
  deliver({ type: "shown", id: "main#1" });
  const shown = emitted.length;

  restChanged();
  const changed = emitted.length;
  deliver({ type: "closed", id: "main#1", refocus: false });
  restChanged();

  expect([pending, changed - shown, emitted.length - changed]).toEqual([1, 1, 0]);
  expect(emitted.at(-1)).toEqual({ type: "state", id: "main#1", state: STATE });
});

it.each([
  [true, 1],
  [false, 0],
])("marks the overlay while the menu shows, and a closed with refocus %s clears it, lets her go and focuses her window %i times", async (refocus, focuses) => {
  const { locomotion, emitted, rightClick, deliver, focusWindow } = wired();
  rightClick();
  await vi.waitFor(() => expect(emitted).toHaveLength(1));

  deliver({ type: "shown", id: "main#1" });
  const shown = marked();
  deliver({ type: "closed", id: "main#1", refocus });

  await vi.waitFor(() => expect(focusWindow).toHaveBeenCalledTimes(focuses));
  expect([shown, marked()]).toEqual([true, false]);
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
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

  await vi.waitFor(() => expect(emitted).toHaveLength(before + 1));
  expect(actions.body).toHaveBeenCalledExactlyOnceWith("natsume");
  expect(emitted.at(-1)).toEqual({
    type: "state",
    id: "main#1",
    state: { ...STATE, body: "natsume" },
  });
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

  expect([before, emitted.at(-1)]).toEqual([false, { type: "close", id: "main#1" }]);
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
});

it("sends no open when an agent move takes her during the geometry reads, and the next open goes out", async () => {
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
