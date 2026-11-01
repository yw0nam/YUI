// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createTextSizeSettings } from "../../../../settings/appearance/text-size-settings";
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
  themeSettings.setTheme("system");
  expect(button("system")?.getAttribute("aria-checked")).toBe("true");
  qc.dispose();
  themeSettings.dispose();
  mount.remove();
  vi.restoreAllMocks();
});

it("sets the text size from its segment and reflects the store", () => {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  const mount = document.createElement("div");
  document.body.append(mount);
  const textSizeSettings = createTextSizeSettings();
  const qc = createQuickControls({ ...defaultQcArgs(mount), textSizeSettings });
  const button = (label: string) =>
    [...qc.el.querySelectorAll<HTMLButtonElement>(".yui-textsize-seg .yui-seg__btn")].find(
      (b) => b.textContent === label,
    );
  qc.open();
  expect(button("100%")?.getAttribute("aria-checked")).toBe("true");
  button("125%")!.click();
  expect(textSizeSettings.get()).toEqual({ scale: 1.25 });
  expect(button("125%")?.getAttribute("aria-checked")).toBe("true");
  expect(button("100%")?.getAttribute("aria-checked")).toBe("false");
  textSizeSettings.setScale(0.9);
  expect(button("90%")?.getAttribute("aria-checked")).toBe("true");
  expect(button("125%")?.getAttribute("aria-checked")).toBe("false");
  qc.dispose();
  textSizeSettings.dispose();
  mount.remove();
  vi.restoreAllMocks();
});
