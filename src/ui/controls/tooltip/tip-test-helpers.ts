import { fireEvent } from "@testing-library/react";
import { act } from "react";

/** The text of the tooltip that shows now, or undefined. */
export const shownTip = (): string | undefined =>
  document.querySelector(".yui-hint-tip[data-open]")?.textContent ?? undefined;

/** A mouse resting on `el`, as Base UI's tooltip reads one; advance 150 ms for the tip. */
export function hoverTip(el: Element): void {
  act(() => {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
    fireEvent.mouseMove(el, { movementX: 4, movementY: 4 });
  });
}

/** Focus reaching `el` by the keyboard: a focus-moving key, then the focus. */
export function keyboardFocus(el: HTMLElement): void {
  act(() => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    el.focus();
  });
}
