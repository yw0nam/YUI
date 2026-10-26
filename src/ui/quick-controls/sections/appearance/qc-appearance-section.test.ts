// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createThemeSettings } from "../../../../settings/appearance/theme-settings";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

it("reflects and sets the theme while open and on reopening", () => {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  const mount = document.createElement("div");
  document.body.append(mount);
  const themeSettings = createThemeSettings();
  themeSettings.setTheme("hearth");
  const qc = createQuickControls({ ...defaultQcArgs(mount), themeSettings });
  const button = (theme: string) =>
    qc.el.querySelector<HTMLButtonElement>(`.yui-theme-seg [data-theme="${theme}"]`);
  qc.open();
  expect(button("hearth")?.getAttribute("aria-checked")).toBe("true");
  button("system")!.click();
  expect(themeSettings.get()).toEqual({ theme: "system" });
  expect(button("system")?.getAttribute("aria-checked")).toBe("true");
  expect(button("hearth")?.getAttribute("aria-checked")).toBe("false");
  themeSettings.setTheme("dawn");
  expect(button("dawn")?.getAttribute("aria-checked")).toBe("true");
  qc.close();
  themeSettings.setTheme("system");
  qc.open();
  expect(button("system")?.getAttribute("aria-checked")).toBe("true");
  qc.dispose();
  themeSettings.dispose();
  mount.remove();
  vi.restoreAllMocks();
});
