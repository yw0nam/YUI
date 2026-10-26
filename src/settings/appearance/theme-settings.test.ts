import { expect, it } from "vitest";
import { createThemeSettings, type ThemeSettings } from "./theme-settings";

it("loads, persists and validates the theme", () => {
  let saved: unknown = { theme: "hearth" };
  const storage = {
    load: () => saved as ThemeSettings,
    save: (value: ThemeSettings) => {
      saved = value;
    },
  };
  const store = createThemeSettings({ storage });
  expect(store.get()).toEqual({ theme: "hearth" });
  store.setTheme("system");
  expect(saved).toEqual({ theme: "system" });
  expect(createThemeSettings({ storage }).get()).toEqual({ theme: "system" });
  saved = { theme: "neon" };
  expect(createThemeSettings({ storage }).get()).toEqual({ theme: "dawn" });
});
