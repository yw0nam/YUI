// @vitest-environment jsdom
/**
 * phone-settings-view.test.ts — the phone's full-screen settings/history view: title, inert
 * background, focus in and back to the opener, Escape and back-button closing, commit on close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../i18n";
import { createPhoneSettingsView } from "./phone-settings-view";

describe("createPhoneSettingsView", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function build() {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    // Whatever the phone shows behind the view — stage, top row, composer.
    const background = document.createElement("div");
    mount.appendChild(background);
    const connection = {
      el: document.createElement("div"),
      refresh: vi.fn(),
      commit: vi.fn(),
      focusStt: vi.fn(),
    };
    const character = { el: document.createElement("div"), refresh: vi.fn() };
    const history = { el: document.createElement("div"), refresh: vi.fn() };
    const general = { el: document.createElement("div"), refresh: vi.fn() };
    const view = createPhoneSettingsView({ mount, connection, character, history, general });
    return { mount, background, connection, character, history, general, view };
  }

  function titleOf(view: ReturnType<typeof createPhoneSettingsView>): string {
    return view.el.querySelector<HTMLElement>(".yui-phone-settings__title")!.textContent ?? "";
  }

  it("open(conn) shows the view titled Connection, hides the background, focuses the tab", () => {
    const { background, connection, character, history, general, view } = build();
    view.open("conn");

    expect(view.isOpen()).toBe(true);
    expect(titleOf(view)).toBe(t("tabs.conn"));
    expect(view.el.querySelector("#yui-tab-conn")!.getAttribute("aria-selected")).toBe("true");
    expect(view.el.querySelector<HTMLElement>("#yui-panel-conn")!.hidden).toBe(false);
    expect(view.el.querySelector<HTMLElement>("#yui-panel-hist")!.hidden).toBe(true);
    // Every tab renders fresh content on open.
    expect(connection.refresh).toHaveBeenCalledTimes(1);
    expect(character.refresh).toHaveBeenCalledTimes(1);
    expect(history.refresh).toHaveBeenCalledTimes(1);
    expect(general.refresh).toHaveBeenCalledTimes(1);
    // The phone behind the view is inert and hidden from assistive tech.
    expect(background.hasAttribute("inert")).toBe(true);
    expect(background.getAttribute("aria-hidden")).toBe("true");
    // Focus lands on the selected tab.
    expect(document.activeElement).toBe(view.el.querySelector("#yui-tab-conn"));

    view.dispose();
  });

  it("open with focus stt selects Connection and focuses the STT field after the refresh", () => {
    const { connection, view } = build();
    connection.focusStt.mockImplementation(() => {
      expect(connection.refresh).toHaveBeenCalledTimes(1);
      expect(view.el.querySelector<HTMLElement>("#yui-panel-conn")!.hidden).toBe(false);
    });

    view.open("conn", { focus: "stt" });

    expect(connection.focusStt).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("open with focus stt on an already open view switches to Connection and focuses the field", () => {
    const { connection, view } = build();
    view.open("hist");

    view.open("conn", { focus: "stt" });

    expect(titleOf(view)).toBe(t("tabs.conn"));
    expect(connection.refresh).toHaveBeenCalledTimes(1);
    expect(connection.focusStt).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("open without focus leaves the STT field alone", () => {
    const { connection, view } = build();
    view.open("conn");
    view.open("conn");

    expect(connection.focusStt).not.toHaveBeenCalled();
    view.dispose();
  });

  it("open(char) titles the view Character and the rail runs Connection, Character, History, General", () => {
    const { view } = build();
    view.open("char");

    expect(titleOf(view)).toBe(t("tabs.char"));
    expect(view.el.querySelector<HTMLElement>("#yui-panel-char")!.hidden).toBe(false);
    expect(view.el.querySelector<HTMLElement>("#yui-panel-conn")!.hidden).toBe(true);
    const order = Array.from(view.el.querySelectorAll(".yui-tab")).map((b) => b.id);
    expect(order).toEqual(["yui-tab-conn", "yui-tab-char", "yui-tab-hist", "yui-tab-general"]);

    view.dispose();
  });

  it("open(hist) titles the view History", () => {
    const { view } = build();
    view.open("hist");

    expect(titleOf(view)).toBe(t("tabs.hist"));
    expect(view.el.querySelector<HTMLElement>("#yui-panel-hist")!.hidden).toBe(false);

    view.dispose();
  });

  it("open(general) titles the view General", () => {
    const { view } = build();
    view.open("general");

    expect(titleOf(view)).toBe(t("tabs.general"));
    expect(view.el.querySelector<HTMLElement>("#yui-panel-general")!.hidden).toBe(false);

    view.dispose();
  });

  it("dispose while open commits the connection tab", () => {
    const { connection, view } = build();
    view.open("conn");

    view.dispose();

    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("selecting a tab on the rail moves the panel and updates the title", () => {
    const { view } = build();
    view.open("conn");

    view.el.querySelector<HTMLButtonElement>("#yui-tab-hist")!.click();

    expect(titleOf(view)).toBe(t("tabs.hist"));
    expect(view.el.querySelector<HTMLElement>("#yui-panel-conn")!.hidden).toBe(true);
    expect(view.el.querySelector<HTMLElement>("#yui-panel-hist")!.hidden).toBe(false);

    view.dispose();
  });

  it("the head back button closes, commits, restores the background and the opener's focus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { background, connection, view } = build();
    view.open("conn");

    view.el.querySelector<HTMLButtonElement>(".yui-phone-settings__back")!.click();

    expect(view.isOpen()).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(background.hasAttribute("inert")).toBe(false);
    expect(background.getAttribute("aria-hidden")).toBeNull();
    expect(document.activeElement).toBe(opener);

    view.dispose();
  });

  it("Escape closes the view", () => {
    const { view, connection } = build();
    view.open("conn");

    view.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(view.isOpen()).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);

    view.dispose();
  });

  it("close() while closed commits nothing and stays closed", () => {
    const { view, connection } = build();
    view.close();

    expect(view.isOpen()).toBe(false);
    expect(connection.commit).not.toHaveBeenCalled();

    view.dispose();
  });

  it("dispose() while open restores the background and removes the view", () => {
    const { mount, background, view } = build();
    view.open("conn");

    view.dispose();

    expect(background.hasAttribute("inert")).toBe(false);
    expect(mount.querySelector(".yui-phone-settings")).toBeNull();
  });
});
