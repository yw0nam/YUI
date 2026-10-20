// @vitest-environment jsdom
// Preset strip, manage popover, and per-tab scope line, through the panel mount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
