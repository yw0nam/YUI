// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger } = await vi.hoisted(
  async () => (await import("./devtools-main.test-helpers")).makeDevtoolsMainMocks(),
);

const { mountMotionPreview } = vi.hoisted(() => ({
  mountMotionPreview: vi.fn(async (mount: HTMLElement) => {
    mount.innerHTML =
      '<select id="sel-crossfade"><option value="idle">idle</option><option value="wave">wave</option></select>';
    return { dispose: vi.fn() };
  }),
}));

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config/store", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./ui/devtools/motion-preview", () => ({ mountMotionPreview }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { resetDevtoolsMain } from "./devtools-main.test-helpers";
import { setLocale } from "./ui/i18n";

afterEach(() => {
  resetDevtoolsMain();
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
