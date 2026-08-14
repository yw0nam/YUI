// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdleMotionSettings } from "../../io/idle-motion-settings";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

const IDLE_POOL = {
  vrma_path: "/motions/calm.vrma",
  variants: [
    "/motions/calm.vrma",
    "/motions/idle_01.vrma",
    "/motions/idle_04.vrma",
    "/motions/idle_12.vrma",
  ],
};

describe("createQuickControls — idle motion section", () => {
  let mount: HTMLElement;
  let idleMotionSettings: ReturnType<typeof createIdleMotionSettings>;
  let qc: ReturnType<typeof createQuickControls>;

  const build = (getIdlePool: () => typeof IDLE_POOL | undefined = () => IDLE_POOL) =>
    createQuickControls({
      ...defaultQcArgs(mount),
      idleMotionSettings,
      getIdlePool,
    });

  const switches = () =>
    Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-motions .yui-switch"));

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    setLocale("ko");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    idleMotionSettings = createIdleMotionSettings();
  });

  afterEach(() => {
    qc?.dispose();
    mount.remove();
    vi.restoreAllMocks();
    setLocale("en");
  });

  it("renders one row per idle variant, in catalog order", () => {
    qc = build();
    qc.open();
    expect(switches().map((s) => s.dataset.variant)).toEqual(IDLE_POOL.variants);
  });

  it("labels each row from i18n, keyed by the variant file stem", () => {
    qc = build();
    qc.open();
    const labels = Array.from(
      qc.el.querySelectorAll<HTMLElement>(".yui-motions .yui-row__label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      "차분히 서 있기",
      "장난스러운 몸짓",
      "머리카락 만지기",
      "한쪽 힙에 기대서기",
    ]);
  });

  it("locks the baseline variant on — disabled switch, aria-checked true", () => {
    qc = build();
    qc.open();
    const baseline = switches()[0]!;
    expect(baseline.dataset.variant).toBe("/motions/calm.vrma");
    expect(baseline.disabled).toBe(true);
    expect(baseline.getAttribute("aria-checked")).toBe("true");
    expect(baseline.closest(".yui-row")!.querySelector(".yui-row__sub")!.textContent).toContain(
      "항상 켜짐",
    );
  });

  it("clicking the baseline switch cannot disable it", () => {
    qc = build();
    qc.open();
    switches()[0]!.click();
    expect(idleMotionSettings.get().disabled).toEqual([]);
    expect(switches()[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("toggling a variant off writes it to the store and reflects in the DOM", () => {
    qc = build();
    qc.open();
    switches()[2]!.click();
    expect(idleMotionSettings.get().disabled).toEqual(["/motions/idle_04.vrma"]);
    expect(switches()[2]!.getAttribute("aria-checked")).toBe("false");
  });

  it("toggling a variant back on clears it from the store", () => {
    qc = build();
    qc.open();
    switches()[2]!.click();
    switches()[2]!.click();
    expect(idleMotionSettings.get().disabled).toEqual([]);
    expect(switches()[2]!.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the toggled switch focused — a rebuild would drop keyboard focus mid-interaction", () => {
    qc = build();
    qc.open();
    const sw = switches()[2]!;
    sw.focus();
    sw.click();
    expect(switches()[2]).toBe(sw); // same node, updated in place
    expect(document.activeElement).toBe(sw);
  });

  it("reflects a store change made elsewhere (cross-window broadcast)", () => {
    qc = build();
    qc.open();
    idleMotionSettings.setEnabled("/motions/idle_12.vrma", false);
    expect(switches()[3]!.getAttribute("aria-checked")).toBe("false");
  });

  it("hides the section while the motion catalog is unavailable", () => {
    qc = build(() => undefined);
    qc.open();
    expect(switches()).toEqual([]);
    expect(qc.el.querySelector<HTMLElement>(".yui-idle-motion")!.hidden).toBe(true);
  });
});
