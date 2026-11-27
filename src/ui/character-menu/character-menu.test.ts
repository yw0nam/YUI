// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./character-menu.css", () => ({}));

import type { MenuState } from "../../io/bridge/settings-bridge";
import { setLocale } from "../i18n";
import { createCharacterMenu, MENU_PILLS } from "./character-menu";

let mount: HTMLElement;
const menus: ReturnType<typeof createCharacterMenu>[] = [];

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  mount = document.createElement("div");
  document.body.appendChild(mount);
});
afterEach(() => {
  for (const menu of menus.splice(0)) menu.dispose();
  vi.useRealTimers();
});

function build(over: Partial<MenuState> = {}) {
  const state: MenuState = {
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
    pace: "normal",
    waiting: 0,
    ...over,
  };
  const order: string[] = [];
  let blur = (): void => {};
  const actions = {
    talk: vi.fn(),
    rest: vi.fn(),
    listen: vi.fn(),
    settings: vi.fn(() => void order.push("settings")),
    body: vi.fn(),
    voice: vi.fn(),
    pace: vi.fn(),
    threads: vi.fn(),
    bubble: vi.fn(),
    unified: vi.fn(),
    reset: vi.fn(),
    turnOff: vi.fn(),
  };
  const restore = vi.fn(async () => void order.push("restore"));
  let kind: "main" | "bound" = "main";
  const menu = createCharacterMenu({
    mount,
    kind: () => kind,
    name: () => "Yui",
    read: () => state,
    place: vi.fn(async () => ({
      fold: "none" as const,
      top: 200,
      chest: { x: 200, y: 260 },
      head: 90,
    })),
    restore,
    actions,
    onBlur: (cb) => {
      blur = cb;
      return () => {};
    },
  });
  menus.push(menu);
  const setKind = (next: "main" | "bound") => {
    kind = next;
  };
  return { menu, actions, restore, order, state, blur: () => blur(), setKind };
}

const labels = (side: "left" | "right") =>
  [...mount.querySelectorAll(`.yui-cmenu__col--${side} .yui-cmenu__label`)].map(
    (e) => e.textContent,
  );
const pill = (id: string) => mount.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
const click = (id: string) => pill(id)?.click();
const focused = () => document.activeElement?.closest("[data-id]")?.getAttribute("data-id") ?? null;
const press = (key: string) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const menuRoot = () => mount.querySelector<HTMLElement>(".yui-cmenu")!;
const outside = () =>
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const leaving = () => [...mount.querySelectorAll<HTMLElement>(".yui-cmenu__col.is-leaving")];
// A mouse click, which carries a click count; Enter and Space click a button with none.
const tap = (id: string) =>
  mount
    .querySelector(`.yui-cmenu__col:not(.is-leaving) [data-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
const opacityEnded = (el: Element) =>
  el.dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "opacity" }));

it("opens with focus on Talk and her name above her", async () => {
  const { menu } = build();

  await menu.open();

  expect(menu.isOpen()).toBe(true);
  expect(focused()).toBe("talk");
  expect(labels("right")).toEqual(["Talk", "Rest", "Listen", "Settings"]);
  expect(labels("left")).toEqual(["Body", "Voice", "Pace", "More"]);
  expect(mount.querySelector(".yui-cmenu__name")?.textContent).toBe("Yui");
});

it("reads her kind on each open, so one menu serves every character", async () => {
  const { menu, setKind } = build();
  await menu.open();
  const main = labels("right");
  press("Escape");
  await menu.close();
  setKind("bound");

  await menu.open();

  expect([main, labels("right")]).toEqual([
    ["Talk", "Rest", "Listen", "Settings"],
    ["Talk", "Rest", "Settings"],
  ]);
});

it("redraws from the state it reads on refresh, focus staying on its row", async () => {
  const { menu, state } = build();
  await menu.open();
  pill("rest")?.focus();
  state.rest = true;

  menu.refresh();

  expect([pill("rest")?.getAttribute("aria-checked"), focused()]).toEqual(["true", "rest"]);
});

it("replaces the left column in place with a list and Back, and Back returns to Body", async () => {
  const { menu } = build();
  await menu.open();

  click("body");
  expect(labels("left")).toEqual(["Back", "Yui", "Natsume", "More…"]);
  expect(labels("right")).toEqual(["Talk", "Rest", "Listen", "Settings"]);
  expect(focused()).toBe("body:yui");

  click("back");
  expect(labels("left")).toEqual(["Body", "Voice", "Pace", "More"]);
  expect(focused()).toBe("body");
});

it("keeps the five bodies it opened with until it closes, a pick only moving the check", async () => {
  const bodies = Array.from({ length: 30 }, (_, i) => ({ id: `o${i + 1}`, label: `O${i + 1}` }));
  const { menu, actions, state } = build({ bodies, body: "o30" });
  actions.body.mockImplementation((id: string) => {
    state.body = id;
  });
  await menu.open();

  click("body");
  click("body:o2");
  click("body");

  // O5 was never drawn, so it was never measured either.
  expect(labels("left")).toEqual(["Back", "O1", "O2", "O3", "O4", "O30", "More…"]);
  expect(pill("body:o2")?.getAttribute("aria-checked")).toBe("true");
});

it("asks before Reset chat with focus on Cancel, and a confirmed reset keeps More open", async () => {
  const { menu, actions } = build();
  await menu.open();
  click("more");

  click("reset");
  expect(document.activeElement?.textContent).toBe("Cancel");
  expect(mount.querySelector(".yui-cmenu__sure")?.textContent).toBe("Sure?");

  mount.querySelector<HTMLButtonElement>(".yui-cmenu__sure")?.click();
  expect(actions.reset).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(true);
  expect(labels("left")[0]).toBe("Back");
  expect(focused()).toBe("reset");
});

it("takes Esc as cancel the confirm, then Back, then close", async () => {
  const { menu, restore } = build();
  await menu.open();
  click("more");
  click("reset");

  press("Escape");
  expect(focused()).toBe("reset");
  expect(mount.querySelector(".yui-cmenu__sure")).toBeNull();
  press("Escape");
  expect(focused()).toBe("more");
  press("Escape");
  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
  expect(menu.isOpen()).toBe(false);
  expect(mount.querySelector(".yui-cmenu__pill")).toBeNull();
});

it.each([
  [
    "a pointerdown outside it",
    () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  ],
  ["focus leaving the window", (blur: () => void) => blur()],
])("leaves on %s, shown until its exit ends, then restores the window once", async (_name, leave) => {
  const { menu, restore, blur } = build();
  await menu.open();
  vi.useFakeTimers();

  leave(blur);

  expect(menuRoot().hidden).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(menuRoot().hidden).toBe(true);
  expect(mount.querySelector(".yui-cmenu__pill")).toBeNull();
  expect(restore).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(false);
});

it.each([
  ["Esc", () => press("Escape")],
  ["a closing pick", () => click("settings")],
])("closes at once on %s and restores the window at once", async (_name, act) => {
  const { menu, restore } = build();
  await menu.open();

  act();

  expect(menuRoot().hidden).toBe(true);
  expect(restore).toHaveBeenCalledOnce();
});

it("takes the menu back when it is opened again during its exit", async () => {
  const { menu, restore } = build();
  await menu.open();
  vi.useFakeTimers();
  outside();
  const columns = [...mount.querySelectorAll(".yui-cmenu__col")];

  await menu.open();

  expect(menuRoot().hidden).toBe(false);
  expect(menuRoot().classList.contains("is-closing")).toBe(false);
  expect(mount.querySelectorAll(".is-out")).toHaveLength(0);
  // The cancelled exit's transitions end late, and its fallback timer passes.
  for (const column of columns) opacityEnded(column);
  await vi.advanceTimersByTimeAsync(1000);
  expect(menu.isOpen()).toBe(true);
  expect(restore).not.toHaveBeenCalled();
});

it("closes at once and restores once when an agent move ends it during its exit", async () => {
  const { menu, restore } = build();
  await menu.open();
  vi.useFakeTimers();
  outside();
  expect(menuRoot().hidden).toBe(false);

  void menu.close();

  expect(menuRoot().hidden).toBe(true);
  expect(restore).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(restore).toHaveBeenCalledOnce();
});

it("keeps the old column inert and out of reach while a list swap crossfades, until its exit ends", async () => {
  const { menu } = build();
  await menu.open();

  tap("more");

  const [old] = leaving();
  expect(leaving()).toHaveLength(1);
  expect(old!.hasAttribute("inert")).toBe(true);
  expect([...old!.querySelectorAll<HTMLElement>("[data-id]")].map((e) => e.dataset.id)).toEqual([
    "body",
    "voice",
    "pace",
    "more",
  ]);
  const targets = [...mount.querySelectorAll(MENU_PILLS)];
  expect(targets.filter((el) => old!.contains(el))).toEqual([]);
  expect(focused()).toBe("threads");

  // A second swap within the exit drops the first old column at once.
  tap("back");
  expect(leaving().map((c) => c.dataset.list)).toEqual(["more"]);
  expect(focused()).toBe("more");

  opacityEnded(leaving()[0]!);
  expect(leaving()).toEqual([]);
});

it("acts on the incoming column when Enter picks during a swap, with no crossfade", async () => {
  const { menu, actions } = build();
  await menu.open();
  tap("body");
  expect(leaving()).toHaveLength(1);
  expect(focused()).toBe("body:yui");

  // Enter on the focused pill clicks it.
  (document.activeElement as HTMLElement).click();

  expect(actions.body).toHaveBeenCalledExactlyOnceWith("yui");
  expect(leaving()).toEqual([]);
  expect(labels("left")).toEqual(["Body", "Voice", "Pace", "More"]);
  expect(focused()).toBe("body");
});

it("marks an ON toggle with the On text, and its pick keeps the menu open", async () => {
  const { menu, actions } = build({ rest: true });
  await menu.open();

  expect(pill("rest")?.getAttribute("aria-checked")).toBe("true");
  expect(pill("rest")?.querySelector(".yui-cmenu__on")?.textContent).toBe("On");
  expect(pill("listen")?.querySelector(".yui-cmenu__on")).toBeNull();

  click("rest");
  expect(actions.rest).toHaveBeenCalledExactlyOnceWith(false);
  expect(menu.isOpen()).toBe(true);
  expect(focused()).toBe("rest");
});

it("runs a closing pick once the window is restored", async () => {
  const { menu, order } = build();
  await menu.open();

  click("settings");

  await vi.waitFor(() => expect(order).toEqual(["restore", "settings"]));
  expect(menu.isOpen()).toBe(false);
});

it("runs a closing pick even when the window fails to restore", async () => {
  const { menu, actions, restore } = build();
  restore.mockImplementation(async () => {
    throw new Error("frame call failed");
  });
  await menu.open();

  click("settings");

  await vi.waitFor(() => expect(actions.settings).toHaveBeenCalledOnce());
  expect(menu.isOpen()).toBe(false);
});

it("names the inline confirm by the pick it confirms", async () => {
  const { menu } = build();
  await menu.open();
  click("more");

  click("reset");

  const sure = mount.querySelector(".yui-cmenu__sure");
  expect(mount.querySelector(".yui-cmenu__confirm")?.getAttribute("aria-label")).toBe(
    "Reset chat?",
  );
  expect(sure?.getAttribute("aria-label")).toBe("Sure? Reset chat");
  expect(sure?.querySelector("svg")).not.toBeNull();
});
