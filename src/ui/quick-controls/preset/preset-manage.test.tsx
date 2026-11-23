// @vitest-environment jsdom
// The manage popover's list, through the preset strip's manage button.
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../../settings/backend/agent-notify-settings";
import { presetIdForWindow } from "../../../settings/preset/active-preset";
import {
  createPresetRegistry,
  type PresetRegistry,
} from "../../../settings/preset/preset-registry";
import { createRelationsSwitch } from "../../../settings/relations/relations-switch";
import { createEditedPreset } from "./edited-preset";
import { closeDialogs, stubModalDialog } from "./photo-dialog/test-helpers";
import { PresetHeader, type PresetHeaderHandle, type PresetHeaderProps } from "./preset-header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(stubModalDialog);

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => closeDialogs());
  act(() => cleanup());
});

const newLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

/** The strip with its manage popover open; returns the popover. */
function openManage(registry: PresetRegistry, over: Partial<PresetHeaderProps> = {}): HTMLElement {
  act(() => {
    render(
      <PresetHeader
        edited={createEditedPreset(registry, presetIdForWindow(), () => {})}
        registry={registry}
        log={newLog()}
        relationsSwitch={createRelationsSwitch({ load: () => null, save() {} })}
        onEditTarget={vi.fn()}
        handle={createRef<PresetHeaderHandle>()}
        {...over}
      />,
      { container: document.body.appendChild(document.createElement("div")) },
    );
  });
  act(() => document.querySelector<HTMLButtonElement>(".yui-preset__manage")!.click());
  return document.querySelector<HTMLElement>(".yui-preset-pop")!;
}
const press = (el: HTMLElement | null) => act(() => el!.click());
const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
};

it("copies the current preset URL, hides when disabled and shows fallback on failure", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const agentNotifySettings = createAgentNotifySettings();
  const log = newLog();
  const el = openManage(registry, { log, agentNotifySettings });
  expect(el.querySelector(".yui-preset-row__url")).toBeNull();
  act(() => {
    agentNotifySettings.setPort(9000);
    agentNotifySettings.setEnabled(true);
  });
  expect(el.querySelector('[data-preset-id="default"] .yui-preset-row__url')).toBeNull();
  expect(el.querySelector('[data-preset-id="abcd1234"] .yui-preset-row__url')).not.toBeNull();
  press(el.querySelector<HTMLButtonElement>(".yui-preset-row__url"));
  expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:9000/presets/abcd1234/signals");
  writeText.mockRejectedValueOnce(new Error("denied"));
  act(() => agentNotifySettings.setPort(9100));
  press(el.querySelector<HTMLButtonElement>(".yui-preset-row__url"));
  await vi.waitFor(() =>
    expect(el.querySelector(".yui-preset-row__url-text")?.textContent).toBe(
      "http://127.0.0.1:9100/presets/abcd1234/signals",
    ),
  );
  expect(log.warn).toHaveBeenCalledWith("ingress_url_copy_failed", expect.any(Object));
  vi.stubGlobal("navigator", {});
  press(el.querySelector<HTMLButtonElement>(".yui-preset-row__url"));
  expect(el.querySelector(".yui-preset-row__url-text")).not.toBeNull();
  registry.dispose();
});

it("removing a preset asks for its thumbnail file's removal", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const log = newLog();
  const removeCardThumbnail = vi.fn(async () => {});
  const el = openManage(registry, { log, removeCardThumbnail });

  press(el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__remove'));
  press(el.querySelector<HTMLButtonElement>(".yui-preset-row__confirm .yui-pill--go"));
  await vi.waitFor(() => expect(removeCardThumbnail).toHaveBeenCalledWith("abcd1234"));
  expect(log.info).toHaveBeenCalledWith("preset_remove", { preset: "abcd1234" });
  registry.dispose();
});

it("a rejected thumbnail removal logs a warning and keeps the removal", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const log = newLog();
  const removeCardThumbnail = vi.fn(async () => {
    throw new Error("remove failed");
  });
  const el = openManage(registry, { log, removeCardThumbnail });

  press(el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__remove'));
  press(el.querySelector<HTMLButtonElement>(".yui-preset-row__confirm .yui-pill--go"));
  await vi.waitFor(() =>
    expect(log.warn).toHaveBeenCalledWith("thumbnail_remove_failed", {
      preset: "abcd1234",
      error: "Error: remove failed",
    }),
  );
  expect(log.info).toHaveBeenCalledWith("preset_remove", { preset: "abcd1234" });
  registry.dispose();
});

it.each([
  "everyone",
  "Here",
  "ALL",
])("a reserved name %j shows as a taken one in the new-name field", (name) => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  const el = openManage(registry);
  press(el.querySelector<HTMLButtonElement>(".yui-add-btn"));
  const input = el.querySelector<HTMLInputElement>("#yui-preset-new-name")!;

  typeInto(input, name);

  expect(el.querySelector(".yui-preset-new")?.classList.contains("is-invalid")).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  registry.dispose();
});

it("a reserved name typed into a rename field shows as a taken one", () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = openManage(registry);
  press(el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__rename'));
  const input = el.querySelector<HTMLInputElement>(".is-renaming input")!;

  typeInto(input, "everyone");

  expect(el.querySelector(".is-renaming")?.classList.contains("is-invalid")).toBe(true);
  registry.dispose();
});

function photoSetup(pickPhoto?: (id: string) => Promise<string | null>) {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = openManage(registry, { pickPhoto });
  const button = () =>
    el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__photo');
  const thumbnail = () => registry.get().list.find((e) => e.id === "abcd1234")?.thumbnail;
  return { registry, button, thumbnail };
}

it("offers a photo button on every row only where a picker is passed", () => {
  const without = photoSetup();
  expect(without.button()).toBeNull();
  without.registry.dispose();
  act(() => cleanup());

  const withPicker = photoSetup(async () => null);
  expect(withPicker.button()?.getAttribute("aria-label")).toBe("Photo for companion");
  withPicker.registry.dispose();
});

const dialog = () => document.querySelector("dialog.yui-photo-dialog");

it("a row without a photo picks one, stores it with no crop and opens the dialog", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(
    async () => "asset://x/abcd1234.png?v=1",
  );
  const { registry, button, thumbnail } = photoSetup(pick);

  press(button());

  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  expect(pick).toHaveBeenCalledWith("abcd1234");
  expect(thumbnail()).toBe("asset://x/abcd1234.png?v=1");
  expect(registry.get().list.find((e) => e.id === "abcd1234")?.crop).toBeUndefined();
  registry.dispose();
});

it("a dismissed picker stores nothing and opens no dialog", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => null);
  const { registry, button, thumbnail } = photoSetup(pick);

  press(button());
  await vi.waitFor(() => expect(pick).toHaveBeenCalled());
  await Promise.resolve();

  expect(thumbnail()).toBeUndefined();
  expect(dialog()).toBeNull();
  registry.dispose();
});

it("a row with a photo opens the dialog without picking", () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => null);
  const { registry, button } = photoSetup(pick);
  act(() => registry.setThumbnail("abcd1234", "asset://x/abcd1234.png"));

  press(button());

  expect(pick).not.toHaveBeenCalled();
  expect(dialog()).not.toBeNull();
  registry.dispose();
});

it("a photo the picker refuses is logged and shown as an error line until the next pick works", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => {
    throw "unsupported file";
  });
  const log = newLog();
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = openManage(registry, { log, pickPhoto: pick });
  const click = () =>
    press(
      el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__photo'),
    );

  click();

  await vi.waitFor(() =>
    expect(el.querySelector(".yui-input-row__error")?.textContent).toBe(
      "Could not use that photo. Choose a PNG or JPEG.",
    ),
  );
  expect(log.warn).toHaveBeenCalledWith("photo_pick_failed", {
    preset: "abcd1234",
    error: "unsupported file",
  });

  pick.mockResolvedValueOnce("asset://x/abcd1234.png?v=1");
  click();
  await vi.waitFor(() => expect(el.querySelector(".yui-input-row__error")).toBeNull());
  registry.dispose();
});
