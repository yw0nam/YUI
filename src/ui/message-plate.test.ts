// @vitest-environment jsdom
/**
 * message-plate.test.ts — the message window's name-plate handle.
 *
 * The plate is the window's title bar: the only thing left on screen when the
 * bubble and the input are gone, the grab target for the OS drag, and the
 * idle/thinking/responding state tell.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { setLocale, t } from "./i18n";
import { createMessagePlate, type MessagePlate } from "./message-plate";

describe("createMessagePlate", () => {
  let mount: HTMLElement;
  let onDock: Mock<() => void>;
  let startDragging: Mock<() => void>;
  let plate: MessagePlate;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    onDock = vi.fn<() => void>();
    startDragging = vi.fn<() => void>();
    plate = createMessagePlate({ mount, onDock, startDragging });
  });

  afterEach(() => {
    setLocale("en");
  });

  const el = (): HTMLElement => mount.querySelector(".yui-plate") as HTMLElement;
  const dock = (): HTMLButtonElement =>
    mount.querySelector(".yui-plate__dock") as HTMLButtonElement;
  const stateLabel = (): HTMLElement => el().querySelector(".yui-plate__state") as HTMLElement;

  it("renders a state dot, the name and a labelled dock button", () => {
    expect(el()).not.toBeNull();
    expect(el().querySelector(".yui-plate__dot")).not.toBeNull();
    expect(el().querySelector(".yui-plate__name")?.textContent).toBe("YUI");
    expect(dock().getAttribute("aria-label")).toBeTruthy();
  });

  it("starts idle with an empty state label", () => {
    expect(el().getAttribute("data-state")).toBe("idle");
    expect(stateLabel().textContent).toBe("");
  });

  it("shows thinking while a turn runs", () => {
    plate.setBusy(true);
    expect(el().getAttribute("data-state")).toBe("thinking");
    expect(stateLabel().textContent).toBe(t("plate.thinking"));
  });

  it("responding outranks thinking, then unwinds back through thinking to idle", () => {
    plate.setBusy(true);
    plate.setLive(true);
    expect(el().getAttribute("data-state")).toBe("responding");
    expect(stateLabel().textContent).toBe(t("plate.responding"));

    plate.setLive(false);
    expect(el().getAttribute("data-state")).toBe("thinking");
    expect(stateLabel().textContent).toBe(t("plate.thinking"));

    plate.setBusy(false);
    expect(el().getAttribute("data-state")).toBe("idle");
    expect(stateLabel().textContent).toBe("");
  });

  it("shows responding when speech streams without a busy turn", () => {
    plate.setLive(true);
    expect(el().getAttribute("data-state")).toBe("responding");
    expect(stateLabel().textContent).toBe(t("plate.responding"));
  });

  it("re-applies the state label on locale change", () => {
    plate.setBusy(true);
    setLocale("ja");
    expect(stateLabel().textContent).toBe(t("plate.thinking"));
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
