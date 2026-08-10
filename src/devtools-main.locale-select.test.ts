// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger } = vi.hoisted(() => ({
  wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
  createConfigStore: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
  })),
  initLogger: vi.fn().mockResolvedValue(undefined),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const { mountMotionPreview } = vi.hoisted(() => ({
  mountMotionPreview: vi.fn(async (mount: HTMLElement) => {
    mount.innerHTML =
      '<select id="sel-crossfade"><option value="idle">idle</option><option value="wave">wave</option></select>';
    return { dispose: vi.fn() };
  }),
}));

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./ui/devtools/motion-preview", () => ({ mountMotionPreview }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { setLocale } from "./ui/i18n";

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  setLocale("en");
  mountMotionPreview.mockClear();
});

it("keeps the focused motion clip-picker select and its selection across a locale rebuild", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  document.querySelector<HTMLButtonElement>('[data-section="motion"]')!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLSelectElement>("#sel-crossfade")).not.toBeNull(),
  );
  const select = document.querySelector<HTMLSelectElement>("#sel-crossfade")!;
  select.focus();
  select.value = "wave";

  setLocale("ja");
  await vi.waitFor(() => expect(mountMotionPreview).toHaveBeenCalledTimes(2));

  const rebuilt = document.querySelector<HTMLSelectElement>("#sel-crossfade")!;
  expect(rebuilt).not.toBe(select);
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.value).toBe("wave");
});
