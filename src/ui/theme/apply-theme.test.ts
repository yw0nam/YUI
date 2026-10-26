// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createThemeSettings, type Theme } from "../../settings/appearance/theme-settings";
import { applyTheme } from "./apply-theme";

function mediaStub(matches: boolean) {
  let listener: (() => void) | undefined;
  const media = {
    matches,
    addEventListener: (_: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: () => {
      listener = undefined;
    },
  };
  return {
    media: media as unknown as MediaQueryList,
    change(dark: boolean) {
      media.matches = dark;
      listener?.();
    },
  };
}

it.each([
  ["dawn", true, "dawn"],
  ["hearth", false, "hearth"],
  ["system", true, "hearth"],
  ["system", false, "dawn"],
] as const)("resolves %s with OS dark %s to %s", (theme: Theme, osDark, expected) => {
  const store = createThemeSettings();
  store.setTheme(theme);
  const root = document.createElement("div");
  const { media } = mediaStub(osDark);
  const dispose = applyTheme({ store, root, matchMedia: () => media });
  expect(root.dataset.theme).toBe(expected);
  dispose();
  store.dispose();
});

it("follows OS appearance and store changes", () => {
  const store = createThemeSettings();
  store.setTheme("system");
  const root = document.createElement("div");
  const { media, change } = mediaStub(false);
  const dispose = applyTheme({ store, root, matchMedia: () => media });
  expect(root.dataset.theme).toBe("dawn");
  change(true);
  expect(root.dataset.theme).toBe("hearth");
  store.setTheme("dawn");
  expect(root.dataset.theme).toBe("dawn");
  dispose();
  store.dispose();
});

it("hands the native title bar the resolved theme", () => {
  const store = createThemeSettings();
  store.setTheme("hearth");
  const setNativeTheme = vi.fn<(theme: "light" | "dark") => Promise<void>>(async () => {});
  const deps = { store, root: document.createElement("div"), setNativeTheme };
  const dispose = applyTheme(deps);
  expect(setNativeTheme).toHaveBeenLastCalledWith("dark");
  store.setTheme("dawn");
  expect(setNativeTheme).toHaveBeenLastCalledWith("light");
  dispose();
  store.dispose();
});
