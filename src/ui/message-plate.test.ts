// @vitest-environment jsdom
/**
 * message-plate.test.ts — the message window's name-plate handle.
 *
 * The plate is the window's title bar: the only thing left on screen when the
 * bubble and the input are gone, the grab target for the OS drag, and the state
 * tell that breathes while speech streams.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessagePlate, type MessagePlate } from "./message-plate";

describe("createMessagePlate", () => {
  let mount: HTMLElement;
  let onDock: ReturnType<typeof vi.fn>;
  let startDragging: ReturnType<typeof vi.fn>;
  let plate: MessagePlate;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    onDock = vi.fn();
    startDragging = vi.fn();
    plate = createMessagePlate({ mount, onDock, startDragging });
  });

  const el = (): HTMLElement => mount.querySelector(".yui-plate") as HTMLElement;
  const dock = (): HTMLButtonElement =>
    mount.querySelector(".yui-plate__dock") as HTMLButtonElement;

  it("renders a state dot, the name and a labelled dock button", () => {
    expect(el()).not.toBeNull();
    expect(el().querySelector(".yui-plate__dot")).not.toBeNull();
    expect(el().querySelector(".yui-plate__name")?.textContent).toBe("YUI");
    expect(dock().getAttribute("aria-label")).toBeTruthy();
  });

  it("lights the dot while speech streams and clears it when it settles", () => {
    plate.setLive(true);
    expect(el().classList.contains("is-live")).toBe(true);
    plate.setLive(false);
    expect(el().classList.contains("is-live")).toBe(false);
  });

  it("reports a dock request when the button is clicked", () => {
    dock().click();
    expect(onDock).toHaveBeenCalledTimes(1);
  });

  it("starts the OS window drag from a press on the plate", () => {
    el().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not drag the window from a press on the dock button", () => {
    dock().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("removes itself and stops responding once disposed", () => {
    plate.dispose();
    expect(mount.querySelector(".yui-plate")).toBeNull();
  });
});
