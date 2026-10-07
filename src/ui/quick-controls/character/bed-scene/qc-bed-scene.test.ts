// @vitest-environment jsdom
/**
 * qc-bed-scene.test.ts — the Character tab's bed-scene section through the full panel:
 * presence gating, the switch driving the store and the number row's visibility,
 * change-only numeric commit, and teardown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBedSceneSettings } from "../../../../settings/avatar/bed-scene-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { countSubscriptions, defaultQcArgs } from "../../test-helpers";

describe("createQuickControls — character tab (bed scene)", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildBedQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const settings = createBedSceneSettings();
    const qc = createQuickControls({
      ...defaultQcArgs(mount),
      bedSceneSettings: settings,
      ...extra,
    });
    return { settings, qc };
  }

  it("renders no bed-scene section without the store", () => {
    const qc = createQuickControls(defaultQcArgs(mount));
    qc.open();
    expect(qc.el.querySelector(".yui-bed-scene")).toBeNull();
    qc.dispose();
  });

  it("the switch writes the store and shows the number row only while on", () => {
    const { settings, qc } = buildBedQc();
    qc.open();
    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-bed-scene__switch")!;
    const row = qc.el.querySelector<HTMLElement>(".yui-bed-scene__timeout")!;
    expect(settings.get().enabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(row.hidden).toBe(false);

    sw.click();
    expect(settings.get().enabled).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(row.hidden).toBe(true);

    sw.click();
    expect(settings.get().enabled).toBe(true);
    expect(row.hidden).toBe(false);
    qc.dispose();
  });

  it("commits a clamped value on change and not on keystroke", () => {
    const { settings, qc } = buildBedQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-bed-wake-timeout")!;
    expect(input.min).toBe("10");
    expect(input.max).toBe("3600");

    input.value = "9";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settings.get().wakeTimeoutS).toBe(120);

    input.value = "99999";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(settings.get().wakeTimeoutS).toBe(3600);
    expect(input.value).toBe("3600");
    qc.dispose();
  });

  it("releases the store subscription on dispose", () => {
    const settings = createBedSceneSettings();
    const counts = countSubscriptions(settings);
    const qc = createQuickControls({ ...defaultQcArgs(mount), bedSceneSettings: settings });
    qc.dispose();
    expect(counts.taken).toBeGreaterThan(0);
    expect(counts.released).toBe(counts.taken);
  });
});
