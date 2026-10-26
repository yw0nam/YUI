// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createPresetRegistry } from "../../../settings/preset/preset-registry";
import { createPresetManage } from "./preset-manage";

// jsdom has no modal dialog: the stubs open and close the element and fire its close event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of document.querySelectorAll("dialog")) d.remove();
});
it("copies the current preset URL, hides when disabled and shows fallback on failure", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  let port: number | null = null;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manage = createPresetManage({
    el,
    registry,
    log,
    presetUrl: (id) => (port ? `http://127.0.0.1:${port}/presets/${id}/signals` : null),
  });
  manage.render();
  expect(el.querySelector(".yui-preset-row__url")).toBeNull();
  port = 9000;
  manage.render();
  expect(el.querySelector('[data-preset-id="default"] .yui-preset-row__url')).toBeNull();
  expect(el.querySelector('[data-preset-id="abcd1234"] .yui-preset-row__url')).not.toBeNull();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:9000/presets/abcd1234/signals");
  writeText.mockRejectedValueOnce(new Error("denied"));
  port = 9100;
  manage.render();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  await vi.waitFor(() =>
    expect(el.querySelector(".yui-preset-row__url-text")?.textContent).toBe(
      "http://127.0.0.1:9100/presets/abcd1234/signals",
    ),
  );
  expect(log.warn).toHaveBeenCalledWith("ingress_url_copy_failed", expect.any(Object));
  vi.stubGlobal("navigator", {});
  manage.render();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  expect(el.querySelector(".yui-preset-row__url-text")).not.toBeNull();
  registry.dispose();
});

it("removing a preset asks for its thumbnail file's removal", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  document.body.appendChild(el);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const removeCardThumbnail = vi.fn(async () => {});
  const manage = createPresetManage({ el, registry, log, removeCardThumbnail });
  manage.render();

  el.querySelector<HTMLButtonElement>(
    '[data-preset-id="abcd1234"] .yui-preset-row__remove',
  )!.click();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__confirm .yui-pill--go")!.click();
  await vi.waitFor(() => expect(removeCardThumbnail).toHaveBeenCalledWith("abcd1234"));
  expect(log.info).toHaveBeenCalledWith("preset_remove", { preset: "abcd1234" });
  registry.dispose();
});

it("a rejected thumbnail removal logs a warning and keeps the removal", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  document.body.appendChild(el);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const removeCardThumbnail = vi.fn(async () => {
    throw new Error("remove failed");
  });
  const manage = createPresetManage({ el, registry, log, removeCardThumbnail });
  manage.render();

  el.querySelector<HTMLButtonElement>(
    '[data-preset-id="abcd1234"] .yui-preset-row__remove',
  )!.click();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__confirm .yui-pill--go")!.click();
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
  const el = document.createElement("div");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manage = createPresetManage({ el, registry, log });
  manage.render();
  el.querySelector<HTMLButtonElement>(".yui-add-btn")!.click();
  const input = el.querySelector<HTMLInputElement>("#yui-preset-new-name")!;

  input.value = name;
  input.dispatchEvent(new Event("input"));

  expect(el.querySelector(".yui-preset-new")?.classList.contains("is-invalid")).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  registry.dispose();
});

it("a reserved name typed into a rename field shows as a taken one", () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manage = createPresetManage({ el, registry, log });
  manage.render();
  el.querySelector<HTMLButtonElement>(
    '[data-preset-id="abcd1234"] .yui-preset-row__rename',
  )!.click();
  const input = el.querySelector<HTMLInputElement>(".is-renaming input")!;

  input.value = "everyone";
  input.dispatchEvent(new Event("input"));

  expect(el.querySelector(".is-renaming")?.classList.contains("is-invalid")).toBe(true);
  registry.dispose();
});

function photoSetup(pickPhoto?: (id: string) => Promise<string | null>) {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manage = createPresetManage({ el, registry, log, pickPhoto });
  manage.render();
  const button = () =>
    el.querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__photo');
  const thumbnail = () => registry.get().list.find((e) => e.id === "abcd1234")?.thumbnail;
  return { registry, manage, button, thumbnail };
}

it("offers a photo button on every row only where a picker is passed", () => {
  const without = photoSetup();
  expect(without.button()).toBeNull();
  without.registry.dispose();

  const withPicker = photoSetup(async () => null);
  expect(withPicker.button()?.getAttribute("aria-label")).toBe("Profile photo for companion");
  withPicker.registry.dispose();
});

const dialog = () => document.querySelector("dialog.yui-photo-dialog");

it("a row without a photo picks one, stores it with no crop and opens the dialog", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(
    async () => "asset://x/abcd1234.png?v=1",
  );
  const { registry, button, thumbnail } = photoSetup(pick);

  button()!.click();

  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  expect(pick).toHaveBeenCalledWith("abcd1234");
  expect(thumbnail()).toBe("asset://x/abcd1234.png?v=1");
  expect(registry.get().list.find((e) => e.id === "abcd1234")?.crop).toBeUndefined();
  registry.dispose();
});

it("a dismissed picker stores nothing and opens no dialog", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => null);
  const { registry, button, thumbnail } = photoSetup(pick);

  button()!.click();
  await vi.waitFor(() => expect(pick).toHaveBeenCalled());
  await Promise.resolve();

  expect(thumbnail()).toBeUndefined();
  expect(dialog()).toBeNull();
  registry.dispose();
});

it("a row with a photo opens the dialog without picking", () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => null);
  const { registry, manage, button } = photoSetup(pick);
  registry.setThumbnail("abcd1234", "asset://x/abcd1234.png");
  manage.render();

  button()!.click();

  expect(pick).not.toHaveBeenCalled();
  expect(dialog()).not.toBeNull();
  registry.dispose();
});

it("a photo the picker refuses is logged and shown as an error line until the next pick works", async () => {
  const pick = vi.fn<(id: string) => Promise<string | null>>(async () => {
    throw "unsupported file";
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  createPresetManage({ el, registry, log, pickPhoto: pick }).render();
  const click = () =>
    el
      .querySelector<HTMLButtonElement>('[data-preset-id="abcd1234"] .yui-preset-row__photo')!
      .click();

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
