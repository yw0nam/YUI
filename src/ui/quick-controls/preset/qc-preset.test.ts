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
import { createPresetStrip, presetStripHtml } from "./preset-strip";

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
    history.replaceState(null, "", "/");
    qc.dispose();
    registry.dispose();
    mount.remove();
  });

  function rebuild(boundId: string | null = null) {
    if (boundId) history.replaceState(null, "", `/?preset=${boundId}`);
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

  function editMode(edit: string, onEditTarget = vi.fn(), boundId: string | null = null) {
    history.replaceState(null, "", `/?${boundId ? `preset=${boundId}&` : ""}edit=${edit}`);
    qc.dispose();
    const petWindows = createPetWindows();
    qc = createQuickControls({
      ...defaultQcArgs(mount),
      presetRegistry: registry,
      petWindows,
      boundId,
      onEditTarget,
    });
    qc.open();
    return { petWindows, onEditTarget };
  }

  it("edit mode: picking a preset hands its id over without activating, open windows included", () => {
    const { petWindows, onEditTarget } = editMode("aaaa0001");
    petWindows.open("bbbb0002");
    const select = $<HTMLSelectElement>(".yui-preset__select");
    expect(Array.from(select.options).map((o) => [o.textContent, o.disabled])).toEqual([
      ["default", false],
      ["natsume", false],
      ["perlica", false],
    ]);
    select.value = "bbbb0002";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onEditTarget).toHaveBeenCalledWith("bbbb0002");
    expect(registry.get().active).toBe("aaaa0001");
    expect(select.disabled).toBe(false);
  });

  it("edit mode: the select and the scope lines name the ?edit= preset, not the active one", () => {
    editMode("bbbb0002");

    expect($<HTMLSelectElement>(".yui-preset__select").value).toBe("bbbb0002");
    expect($(".yui-preset__label").textContent).toBe("Editing");
    expect(qc.el.querySelector("#yui-panel-conn .yui-tabpanel__scope")?.textContent).toBe(
      "perlica · Connection",
    );
  });

  it("edit mode: a non-active row keeps its window button and adds Use in main, disabled while its window is open", () => {
    const { petWindows } = editMode("bbbb0002");
    petWindows.open("default");
    openManage();
    const buttons = (name: string) =>
      Array.from(rowOf(name).querySelectorAll<HTMLButtonElement>(".yui-preset-row__window"));

    expect(buttons("default").map((b) => [b.textContent, b.disabled])).toEqual([
      ["Close window", false],
      ["Use in main", true],
    ]);
    expect(buttons("natsume")).toEqual([]);
    buttons("perlica")[1]!.click();

    expect(registry.get().active).toBe("bbbb0002");
  });

  it("edit mode: the note says where the edited preset lives", () => {
    const note = () => $(".yui-preset__note").textContent;
    editMode("aaaa0001");
    expect(note()).toBe("natsume is shown in main.");
    const { petWindows } = editMode("bbbb0002");
    expect(note()).toBe("perlica is in no window now. Changes are saved and apply when it opens.");
    petWindows.open("bbbb0002");
    expect(note()).toBe("perlica is open in its own window. Changes apply there at once.");
  });

  it("edit mode: the edited preset leaving the registry sends the window to the active one", () => {
    const { onEditTarget } = editMode("bbbb0002");

    registry.remove("bbbb0002");

    expect(onEditTarget).toHaveBeenCalledTimes(1);
    expect(onEditTarget).toHaveBeenCalledWith("aaaa0001");
  });

  it("edit mode: a bound window whose edited preset is deleted returns to its bound preset", () => {
    const { onEditTarget } = editMode("bbbb0002", vi.fn(), "default");

    registry.remove("bbbb0002");

    expect(onEditTarget).toHaveBeenCalledTimes(1);
    expect(onEditTarget).toHaveBeenCalledWith("default");
  });

  it("edit mode: a new preset is seeded from the edited preset", () => {
    editMode("bbbb0002");
    openManage();
    $<HTMLButtonElement>(".yui-preset-pop .yui-add-btn").click();

    expect($(".yui-preset-new .yui-row__sub").textContent).toBe(
      "Copies perlica's settings. Starts with an empty conversation.",
    );
  });

  it("the strip owns its ingress settings subscription and releases it", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const subscribe = agentNotifySettings.subscribe;
    const off = vi.fn();
    vi.spyOn(agentNotifySettings, "subscribe").mockImplementation((cb) => {
      const unsubscribe = subscribe(cb);
      return () => {
        off();
        unsubscribe();
      };
    });
    const root = document.createElement("div");
    root.innerHTML = `${presetStripHtml()}<div class="yui-quick__cols"></div>`;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const strip = createPresetStrip({ root, registry, log, agentNotifySettings });
    root.querySelector<HTMLButtonElement>(".yui-preset__manage")!.click();
    expect(root.querySelector(".yui-preset-row__url")).toBeNull();
    agentNotifySettings.setEnabled(true);
    expect(root.querySelector('[data-preset-id="bbbb0002"] .yui-preset-row__url')).not.toBeNull();
    strip.dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });

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
      ["natsume", "Shown in main", false],
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
