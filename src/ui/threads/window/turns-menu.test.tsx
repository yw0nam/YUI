// @vitest-environment jsdom
/** turns-menu.test.tsx — the Threads window head's Thread turns button and its popover. */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { type TurnsHandle, TurnsMenu } from "./turns-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  setLocale("en");
});
afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
});

function build(level: "off" | "notable" | "every", disabled = false) {
  const onPick = vi.fn();
  const menu = createRef<TurnsHandle>();
  render(<TurnsMenu onPick={onPick} handle={menu} />);
  act(() => menu.current!.set({ level, disabled }));
  const button = document.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!;
  const pop = () => document.querySelector<HTMLElement>(".yui-threads__turns-pop");
  const radio = (name: string) =>
    document.querySelector<HTMLButtonElement>(`[role="radio"][data-level="${name}"]`)!;
  /** Base UI moves focus into the popup in a frame, so the open settles inside the awaited act. */
  const open = async () => {
    await act(async () => {
      fireEvent.click(button);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  };
  return { menu: menu.current!, onPick, button, pop, radio, open };
}

it("picks a level: calls onPick, closes, and returns focus to the button", async () => {
  const { menu, onPick, button, pop, radio, open } = build("off");

  await open();
  expect(pop()).not.toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(radio("off"));

  await act(async () => {
    fireEvent.click(radio("every"));
  });

  expect(onPick).toHaveBeenCalledExactlyOnceWith("every");
  expect(menu.isOpen()).toBe(false);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
});

it("moves between the radios with ArrowUp and ArrowDown, wrapping at the ends", async () => {
  const { pop, radio, open } = build("notable");
  await open();
  const arrow = async (key: string) => {
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key });
    });
  };

  await arrow("ArrowDown");
  expect(document.activeElement).toBe(radio("every"));
  await arrow("ArrowDown");
  expect(document.activeElement).toBe(radio("off"));
  await arrow("ArrowUp");
  await arrow("ArrowUp");
  expect(document.activeElement).toBe(radio("notable"));
  expect(pop()).not.toBeNull();
});

it("disables the radios and names the reason while External signals is off", async () => {
  const { pop, radio, open } = build("off", true);
  await open();

  expect(["off", "notable", "every"].map((name) => radio(name).disabled)).toEqual([
    true,
    true,
    true,
  ]);
  expect(pop()!.querySelector(".yui-threads__turns-note")!.textContent).toBe(
    "Turn on External signals to use this.",
  );
});
