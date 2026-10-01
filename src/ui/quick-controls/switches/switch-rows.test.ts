// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../settings/persisted-store";
import { setLocale } from "../../i18n";
import { createBubblePersistRow } from "../switch-row";
import { bindSwitchRows, reflectSwitchRows, switchRowHtml } from "./switch-rows";

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function mount(settings = createFlagSettings(false)) {
  const row = createBubblePersistRow(settings);
  const root = document.createElement("div");
  root.innerHTML = switchRowHtml(row);
  document.body.append(root);
  const button = root.querySelector<HTMLButtonElement>(row.selector)!;
  return { row, root, button, settings };
}

describe("switch rows", () => {
  beforeEach(() => {
    setLocale("en");
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("the bubble row needs only its store and renders its label, sub and aria state", () => {
    const { root, button } = mount(createFlagSettings(true));
    expect(root.querySelector(".yui-row__label")?.textContent).toBe("Keep until dismissed");
    expect(root.querySelector(".yui-row__sub")).not.toBeNull();
    expect(button.getAttribute("role")).toBe("switch");
    expect(button.getAttribute("aria-checked")).toBe("true");
  });

  it("a click flips the store, logs the row's key and reflect repaints", () => {
    const { root, row, button, settings } = mount();
    const binding = bindSwitchRows(root, [row], log);
    button.click();
    expect(settings.get().enabled).toBe(true);
    expect(log.info).toHaveBeenCalledWith("bubble_persist_toggle", { enabled: true });
    expect(button.getAttribute("aria-checked")).toBe("false");
    binding.reflect();
    expect(button.getAttribute("aria-checked")).toBe("true");
    binding.dispose();
  });

  it("an unavailable row ignores clicks and dispose unbinds the rest", () => {
    const { root, row, button, settings } = mount();
    const off = bindSwitchRows(root, [{ ...row, isAvailable: false }], log);
    button.click();
    expect(settings.get().enabled).toBe(false);
    off.dispose();
    const on = bindSwitchRows(root, [row], log);
    on.dispose();
    button.click();
    expect(settings.get().enabled).toBe(false);
  });

  it("reflectSwitchRows skips a hidden row", () => {
    const { root, row, button, settings } = mount();
    settings.setEnabled(true);
    reflectSwitchRows(root, [{ ...row, isVisible: false }]);
    expect(button.getAttribute("aria-checked")).toBe("false");
  });
});
