// @vitest-environment jsdom
/** turns-menu.test.ts — the Threads window head's Character turns button and its popover. */

import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { createTurnsMenu } from "./turns-menu";

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
});

function build(level: "off" | "notable" | "every", disabled = false) {
  const onPick = vi.fn();
  const menu = createTurnsMenu({ onPick });
  document.body.append(menu.el);
  menu.set({ level, disabled });
  const button = document.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!;
  const pop = document.querySelector<HTMLElement>(".yui-threads__turns-pop")!;
  const radio = (name: string) =>
    document.querySelector<HTMLButtonElement>(`[role="radio"][data-level="${name}"]`)!;
  return { menu, onPick, button, pop, radio };
}

it("picks a level: calls onPick, closes, and returns focus to the button", () => {
  const { menu, onPick, button, pop, radio } = build("off");

  button.click();
  expect(pop.hidden).toBe(false);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(radio("off"));

  radio("every").click();

  expect(onPick).toHaveBeenCalledExactlyOnceWith("every");
  expect(menu.isOpen()).toBe(false);
  expect(pop.hidden).toBe(true);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
});

it("moves between the radios with ArrowUp and ArrowDown, stopping at the ends", () => {
  const { button, pop, radio } = build("notable");
  button.click();
  const arrow = (key: string) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  arrow("ArrowDown");
  expect(document.activeElement).toBe(radio("every"));
  arrow("ArrowDown");
  expect(document.activeElement).toBe(radio("every"));
  arrow("ArrowUp");
  arrow("ArrowUp");
  expect(document.activeElement).toBe(radio("off"));
  expect(pop.hidden).toBe(false);
});

it("disables the radios and names the reason while External signals is off", () => {
  const { button, pop, radio } = build("off", true);
  button.click();

  expect(["off", "notable", "every"].map((name) => radio(name).disabled)).toEqual([
    true,
    true,
    true,
  ]);
  expect(pop.querySelector(".yui-threads__turns-note")!.textContent).toBe(
    "Turn on External signals to use this.",
  );
});
