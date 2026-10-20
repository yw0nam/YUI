// @vitest-environment jsdom
// Preset strip, manage popover, and per-tab scope line, through the panel mount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../../settings/backend/agent-notify-settings";
import {
  clearWindowLive,
  createPetWindows,
  setWindowLive,
} from "../../../settings/preset/pet-windows";
import {
  createPresetRegistry,
  type PresetRegistry,
} from "../../../settings/preset/preset-registry";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "../test-helpers";

describe("createQuickControls — presets", () => {
  let mount: HTMLElement;
  let registry: PresetRegistry;
  let qc: ReturnType<typeof createQuickControls>;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    localStorage.clear();
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "aaaa0001",
        list: [
          { id: "default", name: "default" },
          { id: "aaaa0001", name: "natsume" },
          { id: "bbbb0002", name: "perlica" },
        ],
      }),
    );
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    registry = createPresetRegistry({ newId: () => "cccc0003" });
    qc = createQuickControls({ ...defaultQcArgs(mount), presetRegistry: registry });
    qc.open();
  });

  afterEach(() => {
    qc.dispose();
    registry.dispose();
    mount.remove();
  });

  function rebuild(boundId: string | null = null) {
    qc.dispose();
    const petWindows = createPetWindows();
    const args = defaultQcArgs(mount);
    qc = createQuickControls({
      ...args,
      onPopOut: args.onPopOut,
      presetRegistry: registry,
      petWindows,
      boundId,
    });
    qc.open();
    return petWindows;
  }

  it("refreshes open ingress controls when device settings change", () => {
    qc.dispose();
    const agentNotifySettings = createAgentNotifySettings();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      qc = createQuickControls({
        ...defaultQcArgs(mount),
        presetRegistry: registry,
        agentNotifySettings,
      });
      qc.open();
      openManage();
      expect(qc.el.querySelector(".yui-preset-row__url")).toBeNull();
      agentNotifySettings.setEnabled(true);
      expect(rowOf("perlica").querySelector(".yui-preset-row__url")).not.toBeNull();
      agentNotifySettings.setPort(9100);
      rowOf("perlica").querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
      expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:9100/presets/bbbb0002/signals");
      agentNotifySettings.setEnabled(false);
      expect(qc.el.querySelector(".yui-preset-row__url")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens windows and refreshes controls after the live key clears", () => {
    const petWindows = rebuild();
    openManage();
    rowOf("perlica").querySelector<HTMLButtonElement>(".yui-preset-row__window")!.click();
    expect(JSON.parse(localStorage.getItem("yui.windows")!)).toEqual({ open: ["bbbb0002"] });
    const option = () =>
      $<HTMLSelectElement>(".yui-preset__select").querySelector<HTMLOptionElement>(
        'option[value="bbbb0002"]',
      )!;
    expect(option().disabled).toBe(true);
    expect(option().textContent).toBe("perlica · open as a window");
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).toBeNull();
    setWindowLive("pet-bbbb0002");
    petWindows.close("bbbb0002");
    expect(option().disabled).toBe(true);
    clearWindowLive("pet-bbbb0002");
    petWindows.invalidate();
    expect(option().disabled).toBe(false);
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).not.toBeNull();
  });
  it("shows window actions without a feature flag", () => {
    rebuild();
    openManage();
    expect(qc.el.querySelectorAll(".yui-preset-row__window")).toHaveLength(2);
  });
  it("shows the bound name and protects that row", () => {
    rebuild("bbbb0002");
    openManage();
    expect(qc.el.querySelector(".yui-preset__select")).toBeNull();
    expect(qc.el.querySelectorAll(".yui-iconbtn--popout")).toHaveLength(1);
    expect(qc.el.querySelector(".yui-preset__bound")!.getAttribute("aria-label")).toBe("Preset");
    expect(qc.el.querySelector(".yui-preset__bound")!.textContent).toBe("perlica");
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).toBeNull();
    expect(rowOf("perlica").querySelector(".yui-preset-row__window")).toBeNull();
    registry.rename("bbbb0002", "Perlica");
    expect(qc.el.querySelector(".yui-preset__bound")!.textContent).toBe("Perlica");
  });
  it("leaves controls enabled when activation is refused", () => {
    rebuild();
    setWindowLive("pet-bbbb0002");
    const select = $<HTMLSelectElement>(".yui-preset__select");
    select.value = "bbbb0002";
    select.dispatchEvent(new Event("change"));
    expect(select.disabled).toBe(false);
    expect(qc.el.querySelector(".yui-quick__cols")!.hasAttribute("inert")).toBe(false);
    expect(registry.get().active).toBe("aaaa0001");
  });

  const $ = <T extends Element>(sel: string): T => qc.el.querySelector<T>(sel)!;
  const rows = (): HTMLElement[] =>
    Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-preset-pop .yui-preset-row"));
  const rowOf = (name: string): HTMLElement =>
    rows().find((r) => r.querySelector(".yui-preset-row__name")?.textContent === name)!;
  const openManage = (): void => $<HTMLButtonElement>(".yui-preset__manage").click();
  function typeInto(input: HTMLInputElement, value: string, key?: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (key) input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }

  it("shows the active preset in the strip and names it on each per-preset tab", () => {
    const select = $<HTMLSelectElement>(".yui-preset__select");
    expect(select.value).toBe("aaaa0001");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "default",
      "natsume",
      "perlica",
    ]);
    const scope = (tab: string): string | null | undefined =>
      qc.el.querySelector(`#yui-panel-${tab} .yui-tabpanel__scope`)?.textContent;
    expect(scope("conn")).toBe("natsume · Connection");
    expect(scope("talk")).toBe("natsume · Talk");
    expect(scope("char")).toBe("natsume · Only the VRM selection is per preset");
    expect(scope("general")).toBe("Shared by every preset");
  });

  it("activates the picked preset and holds the panel inert while it switches", () => {
    const select = $<HTMLSelectElement>(".yui-preset__select");
    select.value = "bbbb0002";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(registry.get().active).toBe("bbbb0002");
    expect($(".yui-preset__state").textContent).toBe("Switching to perlica…");
    expect($(".yui-quick__cols").hasAttribute("inert")).toBe(true);
  });

  // Esc hands focus back to the dots button; an outside press leaves it on the control pressed.
  it.each([
    [
      "Escape",
      () => {
        $(".yui-preset-pop button")!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      },
      ".yui-preset__manage",
    ],
    [
      "a press outside it",
      () => {
        const tab = $<HTMLButtonElement>("#yui-tab-conn");
        tab.focus();
        tab.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      },
      "#yui-tab-conn",
    ],
  ])("closes the manage popover on %s", (_label, act, focusSel) => {
    openManage();

    act();

    expect($<HTMLElement>(".yui-preset-pop").hidden).toBe(true);
    expect($(".yui-preset__manage").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe($(focusSel));
    expect(qc.isOpen()).toBe(true);
  });

  it("offers delete on neither the default nor the active preset", () => {
    openManage();

    expect(
      rows().map((r) => [
        r.querySelector(".yui-preset-row__name")?.textContent,
        r.querySelector(".yui-preset-row__badge")?.textContent ?? null,
        !!r.querySelector(".yui-preset-row__remove"),
      ]),
    ).toEqual([
      ["default", null, false],
      ["natsume", "In use", false],
      ["perlica", null, true],
    ]);
  });

  it("creates a preset from the name field and marks a taken name invalid", () => {
    openManage();
    $<HTMLButtonElement>(".yui-preset-pop .yui-add-btn").click();
    const field = $<HTMLElement>(".yui-preset-new");
    const input = field.querySelector<HTMLInputElement>("input")!;

    typeInto(input, "natsume", "Enter");
    expect(field.classList.contains("is-invalid")).toBe(true);
    expect(field.querySelector(".yui-input-row__error")?.textContent).toBe(
      "natsume already exists",
    );
    expect(registry.get().list).toHaveLength(3);

    typeInto(input, "kanna", "Enter");
    expect(registry.get().list.at(-1)).toEqual({ id: "cccc0003", name: "kanna" });
    expect(rows().map((r) => r.querySelector(".yui-preset-row__name")?.textContent)).toEqual([
      "default",
      "natsume",
      "perlica",
      "kanna",
    ]);
  });

  it("renames a preset inline", () => {
    openManage();
    rowOf("perlica").querySelector<HTMLButtonElement>(".yui-preset-row__rename")!.click();
    const input = $<HTMLInputElement>(".yui-preset-row.is-renaming input");

    typeInto(input, "endmin", "Enter");

    expect(registry.get().list[2]).toEqual({ id: "bbbb0002", name: "endmin" });
    expect(rowOf("endmin")).toBeInstanceOf(HTMLElement);
  });

  it("deletes a preset after the inline confirm", () => {
    openManage();
    rowOf("perlica").querySelector<HTMLButtonElement>(".yui-preset-row__remove")!.click();

    expect($(".yui-preset-pop .yui-confirm__q").textContent).toBe(
      "Delete perlica and its conversation?",
    );
    $<HTMLButtonElement>(".yui-preset-pop .yui-pill--go").click();

    expect(registry.get().list.map((e) => e.name)).toEqual(["default", "natsume"]);
  });
});
