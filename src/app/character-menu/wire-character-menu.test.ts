// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../ui/character-menu/character-menu.css", () => ({}));

import { setLocale } from "../../ui/i18n";
import { wireCharacterMenu } from "./wire-character-menu";

let stage: HTMLElement;
let overlay: HTMLElement;
let root: HTMLElement;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  stage = document.createElement("div");
  overlay = document.createElement("div");
  root = document.createElement("div");
  root.append(stage, overlay);
  document.body.append(root);
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
});

type MenuRenderer = Parameters<typeof wireCharacterMenu>[0]["renderer"];

function wired(
  frameWindow: () => unknown,
  renderer: MenuRenderer = { getTapPoints: () => null, getSilhouetteBounds: () => null },
) {
  const end = vi.fn(async () => {});
  const locomotion = {
    hold: vi.fn(),
    abortTravel: vi.fn(async () => {}),
    widen: vi.fn(async (_via: unknown) => ({ win: {} as never, end })),
    frame: {
      frameWindow: vi.fn(frameWindow) as never,
      listMonitors: vi.fn(async () => [
        {
          position: { x: 0, y: 0 },
          size: { width: 2880, height: 1800 },
          workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1750 } },
          scaleFactor: 2,
        },
      ]),
    },
  };
  const openSettings = vi.fn();
  teardowns.push(
    wireCharacterMenu({
      stage,
      root,
      overlay,
      kind: "main",
      name: () => "Yui",
      renderer,
      locomotion,
      ports: {
        read: () => ({
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
        }),
        actions: {
          talk: vi.fn(),
          rest: vi.fn(),
          listen: vi.fn(),
          settings: openSettings,
          body: vi.fn(),
          voice: vi.fn(),
          pace: vi.fn(),
          threads: vi.fn(),
          bubble: vi.fn(),
          unified: vi.fn(),
          reset: vi.fn(),
          turnOff: vi.fn(),
        },
      },
    }),
  );
  const rightClick = () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    return event;
  };
  const talk = () => overlay.querySelector<HTMLButtonElement>('[data-id="talk"]');
  return { locomotion, end, openSettings, rightClick, talk };
}

const box = (edge: "left" | "width" | "top") => root.style.getPropertyValue(`--yui-box-${edge}`);

// Her 400px window at logical 300,517; with nothing measured her own half bounds both reaches.
const tauriWindow = () => ({
  outerPosition: async () => ({ x: 600, y: 1034 }),
  outerSize: async () => ({ width: 800, height: 1200 }),
  scaleFactor: async () => 2,
});

it("opens the menu on a right-click on her, widened around her and holding her still", async () => {
  const { locomotion, rightClick, talk } = wired(tauriWindow);

  const event = rightClick();

  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(document.activeElement).toBe(talk()));
  expect(locomotion.hold).toHaveBeenCalledExactlyOnceWith("menu", true, {
    onAbort: expect.any(Function),
  });
  // Her head reads 0 with no bones, so the window grows 8px upward to keep the columns 8px below its top.
  expect(locomotion.widen).toHaveBeenCalledWith([
    { x: 300, y: 509 },
    { x: 300, y: 509 },
  ]);
  // Her own box inside the widened window, which the UI layer and the status pill lay out in.
  expect([box("left"), box("width")]).toEqual(["0px", "400px"]);
});

// Her head y px down her window: the columns start there unless a bottom edge is closer.
const headAt = (y: number): MenuRenderer => ({
  getTapPoints: () => ({
    head: { x: 200, y },
    chest: { x: 200, y: y + 60 },
    hips: null,
    charHpx: 400,
  }),
  getSilhouetteBounds: () => null,
});
const columnTops = () =>
  [...overlay.querySelectorAll<HTMLElement>(".yui-cmenu__col")].map((c) => c.style.top);

it("sets both columns' top 8px above the work-area bottom for her tallest list", async () => {
  const { rightClick, talk } = wired(tauriWindow, headAt(200));

  rightClick();

  await vi.waitFor(() => expect(talk()).not.toBeNull());
  // The work area ends 383px below her window top; More, six rows, is 256px tall: 383 - 8 - 256.
  expect(columnTops()).toEqual(["119px", "119px"]);
  expect(box("top")).toBe("0px");
});

it("grows the window upward for a column taller than her window, and returns it on close", async () => {
  // Her 400x284 window at logical -100,517: near the left edge, so all eight items fold into one column.
  const { locomotion, rightClick, talk } = wired(
    () => ({
      outerPosition: async () => ({ x: -200, y: 1034 }),
      outerSize: async () => ({ width: 800, height: 568 }),
      scaleFactor: async () => 2,
    }),
    headAt(120),
  );

  rightClick();

  await vi.waitFor(() => expect(talk()).not.toBeNull());
  // 344px of column needs 360px with both 8px edges, 76px more than her window: 284 - 8 - 344 = -68.
  expect(overlay.querySelectorAll(".yui-cmenu__col > *")).toHaveLength(8);
  expect(locomotion.widen).toHaveBeenCalledWith([
    { x: -100, y: 441 },
    { x: -100, y: 441 },
  ]);
  // Her box starts 76px down the grown window, so the column spans 8px to 352px of its 360px.
  expect([box("top"), ...columnTops()]).toEqual(["76px", "-68px"]);

  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  await vi.waitFor(() => expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false));
  expect(box("top")).toBe("");
});

it("restores the window, unpins the overlay and releases her before a closing pick runs", async () => {
  const { locomotion, end, openSettings, rightClick, talk } = wired(tauriWindow);
  rightClick();
  await vi.waitFor(() => expect(talk()).not.toBeNull());
  const order: string[] = [];
  // The window settles a tick after the end call, so only a pick that waits for it runs after.
  end.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    order.push("end");
  });
  openSettings.mockImplementation(() => void order.push("settings"));

  overlay.querySelector<HTMLButtonElement>('[data-id="settings"]')?.click();

  await vi.waitFor(() => expect(order).toEqual(["end", "settings"]));
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
  expect([box("left"), box("width")]).toEqual(["", ""]);
});

it("closes when an agent move ends the widened window", async () => {
  const { locomotion, rightClick, talk } = wired(tauriWindow);
  rightClick();
  await vi.waitFor(() => expect(talk()).not.toBeNull());
  const onAbort = locomotion.hold.mock.calls[0]?.[2]?.onAbort;

  onAbort?.();

  await vi.waitFor(() => expect(talk()).toBeNull());
  expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false);
});

it("opens in the window as it is where there is no OS window to widen", async () => {
  const { locomotion, rightClick, talk } = wired(() => {
    throw new Error("wireTravelFrame: not ready");
  });

  rightClick();

  await vi.waitFor(() => expect(document.activeElement).toBe(talk()));
  expect(locomotion.widen).not.toHaveBeenCalled();
  expect(box("width")).toBe("");
});

it("releases her and stays closed when the menu cannot be placed", async () => {
  const { locomotion, rightClick, talk } = wired(tauriWindow, {
    getTapPoints: () => {
      throw new Error("no bones yet");
    },
    getSilhouetteBounds: () => null,
  });

  rightClick();

  await vi.waitFor(() => expect(locomotion.hold).toHaveBeenLastCalledWith("menu", false));
  expect(talk()).toBeNull();
});
