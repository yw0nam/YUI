// @vitest-environment jsdom
// Preset strip, manage popover, and per-tab scope line, through the panel mount.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createRelationsSwitch } from "../../../settings/relations/relations-switch";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "../test-helpers";
import { closeDialogs, stubModalDialog } from "./photo-dialog/test-helpers";
import { createPresetStrip, presetStripHtml } from "./preset-strip";

describe("createQuickControls — presets", () => {
  beforeAll(stubModalDialog);

  let mount: HTMLElement;
  let registry: PresetRegistry;
  let qc: ReturnType<typeof createQuickControls>;
  let onCloseWindow: ReturnType<typeof vi.fn<() => void>>;

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
    onCloseWindow = vi.fn<() => void>();
    qc = createQuickControls({ ...defaultQcArgs(mount), presetRegistry: registry, onCloseWindow });
    qc.open();
  });

  afterEach(() => {
    closeDialogs();
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
      presetRegistry: registry,
      petWindows,
      boundId,
    });
    qc.open();
    return petWindows;
  }

  function editing(edit: string, onEditTarget = vi.fn(), boundId: string | null = null) {
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

  const heads = () => [...qc.el.querySelectorAll<HTMLButtonElement>(".yui-chead__item")];
  const head = (name: string) =>
    heads().find((b) => b.querySelector(".yui-chead__name")?.textContent === name)!;

  it("the header lists every character with its transport and window state", () => {
    localStorage.setItem("yui.endpoints", JSON.stringify({ chat_api: "push" }));
    localStorage.setItem(
      "yui.bbbb0002.endpoints",
      JSON.stringify({ chat_api: "chat_completions" }),
    );
    const { petWindows } = editing("aaaa0001");
    petWindows.open("bbbb0002");

    expect(
      heads().map((b) => [
        b.querySelector(".yui-chead__name")!.textContent,
        b.querySelector(".yui-chead__meta")!.textContent,
      ]),
    ).toEqual([
      ["default", "Push · Off"],
      ["natsume", "Responses · In main"],
      ["perlica", "Chat Completions · Window open"],
    ]);
  });

  it("clicking a character hands its id over without activating; an off one is dimmed and clickable", () => {
    const { onEditTarget } = editing("aaaa0001");

    expect(head("natsume").getAttribute("aria-current")).toBe("true");
    expect([head("default").classList.contains("is-off"), head("default").disabled]).toEqual([
      true,
      false,
    ]);
    head("perlica").click();

    expect(onEditTarget).toHaveBeenCalledWith("bbbb0002");
    expect(registry.get().active).toBe("aaaa0001");
  });

  it("the header and the scope lines name the ?edit= preset, not the active one", () => {
    editing("bbbb0002");

    expect(head("perlica").getAttribute("aria-current")).toBe("true");
    expect(qc.el.querySelector("#yui-panel-conn .yui-tabpanel__scope")?.textContent).toBe(
      "Only perlica",
    );

    expect(registry.get().active).toBe("aaaa0001");
  });

  it("a non-active row offers Use in main, disabled while its window is open", () => {
    const { petWindows } = editing("bbbb0002");
    petWindows.open("default");
    openManage();
    const buttons = (name: string) =>
      Array.from(rowOf(name).querySelectorAll<HTMLButtonElement>(".yui-preset-row__window"));

    expect(buttons("default").map((b) => [b.textContent, b.disabled])).toEqual([
      ["Use in main", true],
    ]);
    expect(buttons("natsume")).toEqual([]);
    buttons("perlica")[0]!.click();

    expect(registry.get().active).toBe("bbbb0002");
  });

  it("the note says where the edited preset lives", () => {
    const note = () => $(".yui-preset__note").textContent;
    editing("aaaa0001");
    expect(note()).toBe("natsume is shown in main.");
    const { petWindows } = editing("bbbb0002");
    expect(note()).toBe("perlica is in no window now. Changes are saved and apply when it opens.");
    petWindows.open("bbbb0002");
    expect(note()).toBe("perlica is open in its own window. Changes apply there at once.");
  });

  it("the edited preset leaving the registry sends the window to the active one", () => {
    const { onEditTarget } = editing("bbbb0002");

    registry.remove("bbbb0002");

    expect(onEditTarget).toHaveBeenCalledTimes(1);
    expect(onEditTarget).toHaveBeenCalledWith("aaaa0001");
  });

  it("a bound window whose edited preset is deleted returns to its bound preset", () => {
    const { onEditTarget } = editing("bbbb0002", vi.fn(), "default");

    registry.remove("bbbb0002");

    expect(onEditTarget).toHaveBeenCalledTimes(1);
    expect(onEditTarget).toHaveBeenCalledWith("default");
  });

  it("a new preset is seeded from the edited preset", () => {
    editing("bbbb0002");
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
    const strip = createPresetStrip({
      root,
      registry,
      log,
      agentNotifySettings,
      relationsSwitch: createRelationsSwitch({ load: () => null, save() {} }),
      onEditTarget: vi.fn(),
    });
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

  it("refreshes controls when a window opens and after the live key clears", () => {
    const petWindows = rebuild();
    openManage();
    petWindows.open("bbbb0002");
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).toBeNull();
    setWindowLive("pet-bbbb0002");
    petWindows.close("bbbb0002");
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).toBeNull();
    clearWindowLive("pet-bbbb0002");
    petWindows.invalidate();
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).not.toBeNull();
  });
  it("protects a bound window's own row", () => {
    rebuild("bbbb0002");
    openManage();
    expect(rowOf("perlica").querySelector(".yui-preset-row__remove")).toBeNull();
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

  it("a photo picked in the manage list shows in the character header", async () => {
    const url = "asset://localhost/app-data/cards/aaaa0001.png?v=1";
    const pickPresetPhoto = vi.fn(async () => url);
    qc.dispose();
    qc = createQuickControls({
      ...defaultQcArgs(mount),
      presetRegistry: registry,
      pickPresetPhoto,
    });
    qc.open();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    openManage();
    rowOf("natsume").querySelector<HTMLButtonElement>(".yui-preset-row__photo")!.click();

    await vi.waitFor(() => expect(head("natsume").querySelector("img")?.src).toBe(url));
    expect(pickPresetPhoto).toHaveBeenCalledWith("aaaa0001");
    expect(document.querySelector("dialog.yui-photo-dialog")).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("a press inside an open dialog leaves the manage popover open", () => {
    openManage();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    const inner = dialog.appendChild(document.createElement("button"));

    inner.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect($<HTMLElement>(".yui-preset-pop").hidden).toBe(false);
    dialog.remove();
  });

  it("names the shown preset on each character page and the rail group", () => {
    const scope = (tab: string): string | null | undefined =>
      qc.el.querySelector(`#yui-panel-${tab} .yui-tabpanel__scope`)?.textContent;
    expect(scope("conn")).toBe("Only natsume");
    expect(scope("persona")).toBe("Only natsume");
    expect(scope("body")).toBe("Only natsume");
    expect(scope("together")).toBe("Every character");
    expect(scope("general")).toBe("Every character");
    expect(qc.el.querySelector("#yui-tab-conn")?.previousElementSibling?.textContent).toBe(
      "natsume",
    );
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
    expect(onCloseWindow).not.toHaveBeenCalled();
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
