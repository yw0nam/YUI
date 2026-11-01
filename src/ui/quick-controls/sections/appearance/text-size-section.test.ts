// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createTextSizeSettings } from "../../../../settings/appearance/text-size-settings";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

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
