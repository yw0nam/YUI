// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./character-menu.css", () => ({}));

import { setLocale } from "../i18n";
import { createCharacterMenu } from "./character-menu";
import type { MenuState } from "./items";

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
  const menu = createCharacterMenu({
    mount,
    kind: "main",
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
  return { menu, actions, restore, order, blur: () => blur() };
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

it("opens with focus on Talk and her name above her", async () => {
  const { menu } = build();

  await menu.open();

  expect(menu.isOpen()).toBe(true);
  expect(focused()).toBe("talk");
  expect(labels("right")).toEqual(["Talk", "Rest", "Listen", "Settings"]);
  expect(labels("left")).toEqual(["Body", "Voice", "Pace", "More"]);
  expect(mount.querySelector(".yui-cmenu__name")?.textContent).toBe("Yui");
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
])("closes on %s", async (_name, leave) => {
  const { menu, restore, blur } = build();
  await menu.open();
  expect(menu.isOpen()).toBe(true);

  leave(blur);

  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
  expect(menu.isOpen()).toBe(false);
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
