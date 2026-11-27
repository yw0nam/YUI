// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../ui/character-menu/character-menu.css", () => ({}));

import { setLocale } from "../../ui/i18n";
import { createDisposers } from "../disposers";
import { wireCharacterMenuWindow } from "./wire-character-menu-window";

type Deps = Parameters<typeof wireCharacterMenuWindow>[0];

const STATE = {
  talk: false,
  rest: false,
  listen: false,
  bubble: false,
  unified: false,
  bodies: [],
  body: "",
  voices: [],
  voice: "",
  pace: "normal",
  waiting: 0,
};

// Her 100x200 window: the columns, unmeasured in jsdom, reach 104px each side of her centre and,
// six rows tall, need the window grown 72px above hers.
const open = (n: number) => ({
  type: "open",
  id: `main#${n}`,
  from: "main",
  kind: "main",
  name: "Yui",
  state: STATE,
  frame: { x: 670, y: 300, width: 100, height: 200 },
  workArea: { x: 0, y: 25, width: 1440, height: 875 },
  head: 40,
  nameTop: 20,
  chest: { x: 50, y: 100 },
  hitTest: {
    hysteresis_margin_px: 12,
    poll_interval_ms: 50,
    debounce_samples: 2,
    alpha_threshold: 0.1,
  },
});
const RECT = { x: 616, y: 228, width: 208, height: 272 };

let app: HTMLElement;
let lifecycle: ReturnType<typeof createDisposers>;

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  app = document.createElement("div");
  document.body.append(app);
  lifecycle = createDisposers();
});
afterEach(() => {
  lifecycle.dispose();
  vi.useRealTimers();
});

async function wired() {
  const calls: unknown[] = [];
  let deliver: (message: unknown) => void = () => {};
  let blur: () => void = () => {};
  const win = {
    setFrame: vi.fn(async (rect: unknown) => void calls.push(["frame", rect])),
    show: vi.fn(async () => void calls.push("show")),
    setFocus: vi.fn(async () => void calls.push("focus")),
    // Hiding the focused window blurs it.
    hide: vi.fn(async () => {
      calls.push("hide");
      blur();
    }),
    onBlur: async (cb: () => void) => {
      blur = cb;
      return () => {};
    },
    clickThrough: () => ({
      start: () => void calls.push("start"),
      stop: () => void calls.push("stop"),
    }),
  };
  const bridge = {
    emitCharacterMenu: (message: unknown) => void calls.push(["emit", message]),
    onCharacterMenu: (cb: (message: never) => void) => {
      deliver = cb as (message: unknown) => void;
      return () => {};
    },
    onSettingsChanged: () => () => {},
    listening: async () => {},
    dispose: () => {},
  };
  await wireCharacterMenuWindow({
    app,
    lifecycle,
    bridge: bridge as unknown as Deps["bridge"],
    win: win as unknown as Deps["win"],
  });
  calls.length = 0;
  const emits = () =>
    calls
      .filter((c): c is [string, unknown] => Array.isArray(c) && c[0] === "emit")
      .map((c) => c[1]);
  return {
    calls,
    win,
    emits,
    deliver: (message: unknown) => deliver(message),
    blur: () => blur(),
    shown: (n: number) =>
      vi.waitFor(() => expect(emits()).toContainEqual({ type: "shown", id: `main#${n}` })),
  };
}

const pill = (id: string) => app.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
const press = (key: string) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

it("places its window beside her while hidden, then shows it, takes focus, starts click-through and reports shown", async () => {
  const { calls, deliver, shown } = await wired();

  deliver(open(1));

  await shown(1);
  const box = app.querySelector<HTMLElement>(".yui-cmenu-box")!;
  expect(calls).toEqual([
    ["frame", RECT],
    "show",
    "focus",
    "start",
    ["emit", { type: "shown", id: "main#1" }],
  ]);
  expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
    "54px",
    "72px",
    "100px",
    "200px",
  ]);
});

it("sends a pick to the pet that opened it, and redraws from the state the pet sends back", async () => {
  const { emits, deliver, shown } = await wired();
  deliver(open(1));
  await shown(1);

  pill("rest")?.click();
  deliver({ type: "state", id: "main#1", state: { ...STATE, rest: true } });

  expect([emits().at(-1), pill("rest")?.getAttribute("aria-checked")]).toEqual([
    { type: "action", id: "main#1", action: "rest", value: true },
    "true",
  ]);
});

it.each([
  [
    "a close request",
    false,
    (h: Awaited<ReturnType<typeof wired>>) => h.deliver({ type: "close", id: "main#1" }),
  ],
  ["Esc", true, () => press("Escape")],
  ["its window losing focus", false, (h: Awaited<ReturnType<typeof wired>>) => h.blur()],
])("on %s stops click-through, hides and reports closed with refocus %s", async (_name, refocus, act) => {
  const handle = await wired();
  handle.deliver(open(1));
  await handle.shown(1);
  handle.calls.length = 0;

  act(handle);

  await vi.waitFor(() => expect(handle.calls).toHaveLength(3));
  expect(handle.calls).toEqual([
    "stop",
    "hide",
    ["emit", { type: "closed", id: "main#1", refocus }],
  ]);
});

it("sends a closing pick to the first pet after another open took the window", async () => {
  const { emits, deliver, shown } = await wired();
  deliver(open(1));
  await shown(1);

  pill("settings")?.click();
  deliver(open(2));

  await shown(2);
  expect(emits()).toEqual([
    { type: "shown", id: "main#1" },
    { type: "closed", id: "main#1", refocus: true },
    { type: "action", id: "main#1", action: "settings" },
    { type: "shown", id: "main#2" },
  ]);
});

it("hands its window to the latest of several opens, reporting each one it closed or skipped", async () => {
  const { emits, deliver, shown, win } = await wired();
  deliver(open(1));
  await shown(1);

  deliver(open(2));
  deliver(open(3));

  await shown(3);
  expect(emits()).toEqual([
    { type: "shown", id: "main#1" },
    { type: "closed", id: "main#1", refocus: false },
    { type: "closed", id: "main#2", refocus: false },
    { type: "shown", id: "main#3" },
  ]);
  expect(win.show).toHaveBeenCalledTimes(2);
});

it("reports closed without refocus when its window cannot show", async () => {
  const { calls, emits, deliver, win } = await wired();
  win.show.mockRejectedValueOnce(new Error("no window"));

  deliver(open(1));

  await vi.waitFor(() => expect(emits()).toHaveLength(1));
  expect(emits()).toEqual([{ type: "closed", id: "main#1", refocus: false }]);
  expect(calls).toContain("hide");
  expect(pill("talk")).toBeNull();
});
