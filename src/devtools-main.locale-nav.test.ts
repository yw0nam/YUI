// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const { wireDevtoolsSync, createConfigStore, initLogger, createLogger } = await vi.hoisted(
  async () => (await import("./devtools-main.test-helpers")).makeDevtoolsMainMocks(),
);

vi.mock("./bootstrap-wiring", () => ({ wireDevtoolsSync }));
vi.mock("./config/store", () => ({ createConfigStore }));
vi.mock("./logger", () => ({ initLogger, createLogger }));
vi.mock("./io/settings-stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./io/settings-stores")>();
  return { ...actual, createSettingsStores: vi.fn(actual.createSettingsStores) };
});

import { resetDevtoolsMain } from "./devtools-main.test-helpers";
import { setLocale } from "./ui/i18n";

// jsdom lacks CSS.escape — polyfill (mirrors quick-controls/test-helpers.ts).
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: mirror the real escape's control-char handling.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

afterEach(() => {
  resetDevtoolsMain();
  setLocale("en");
});

it("keeps focus on the active nav button across a locale rebuild", async () => {
  document.body.innerHTML = '<div id="app"></div>';

  await import("./devtools-main");
  await vi.waitFor(() => expect(document.querySelector(".devtools-nav")).not.toBeNull());

  const advanced = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  advanced.focus();

  setLocale("ja");
  await vi.waitFor(() => {
    // The pre-rebuild button already satisfies activeElement === querySelector(...), so the
    // wait must also require a fresh node — otherwise it resolves before the rebuild runs.
    const current = document.querySelector('[data-section="advanced"]');
    expect(current).not.toBe(advanced);
    expect(document.activeElement).toBe(current);
  });

  const rebuilt = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  expect(rebuilt).not.toBe(advanced);
  expect(document.activeElement).toBe(rebuilt);
});
