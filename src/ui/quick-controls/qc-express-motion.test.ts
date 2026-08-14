// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExpressMotionSettings } from "../../io/express-motion-settings";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

const VOCAB = ["happy", "laugh", "embarrassed", "sheepish", "calm", "sulk", "sleeping", "dance"];

describe("createQuickControls — express motion section", () => {
  let mount: HTMLElement;
  let expressMotionSettings: ReturnType<typeof createExpressMotionSettings>;
  let qc: ReturnType<typeof createQuickControls>;

  const build = (getExpressMotions: () => string[] = () => VOCAB) =>
    createQuickControls({
      ...defaultQcArgs(mount),
      expressMotionSettings,
      getExpressMotions,
    });

  const groups = () => Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-express__group"));
  const toggles = () =>
    Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-express__toggle"));
  const masters = () =>
    Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-express__master"));
  const rowSwitches = () =>
    Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-express__rows .yui-switch"));
  const expand = (index: number) => toggles()[index]!.click();

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
    expressMotionSettings = createExpressMotionSettings();
  });

  afterEach(() => {
    qc?.dispose();
    mount.remove();
    vi.restoreAllMocks();
    setLocale("en");
  });

  it("renders one collapsed group per category, named from i18n", () => {
    qc = build();
    qc.open();
    expect(toggles().map((t) => t.dataset.group)).toEqual(["reaction", "action"]);
    expect(
      Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-express__name")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["감정 리액션", "동작 · 상태"]);
    expect(toggles().every((t) => t.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(rowSwitches()).toEqual([]);
  });

  it("shows an on/total count on every collapsed group header", () => {
    qc = build();
    expressMotionSettings.setEnabled("sulk", false);
    qc.open();
    expect(
      Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-express__count")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["5/6 켜짐", "2/2 켜짐"]);
  });

  it("expanding a group reveals its motion rows, labelled from i18n", () => {
    qc = build();
    qc.open();
    expand(0);
    expect(rowSwitches().map((s) => s.dataset.motion)).toEqual([
      "happy",
      "laugh",
      "embarrassed",
      "sheepish",
      "calm",
      "sulk",
    ]);
    expect(toggles()[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(
      qc.el.querySelector<HTMLElement>(".yui-express__rows .yui-row__label")!.textContent,
    ).toBe("기쁨");
  });

  it("collapsing an expanded group hides its rows again", () => {
    qc = build();
    qc.open();
    expand(0);
    expand(0);
    expect(rowSwitches()).toEqual([]);
    expect(toggles()[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggling a motion off writes it to the store and reflects in the DOM", () => {
    qc = build();
    qc.open();
    expand(0);
    rowSwitches()[1]!.click();
    expect(expressMotionSettings.get().disabled).toEqual(["laugh"]);
    expect(rowSwitches()[1]!.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the toggled switch focused — a rebuild would drop keyboard focus mid-interaction", () => {
    qc = build();
    qc.open();
    expand(0);
    const sw = rowSwitches()[1]!;
    sw.focus();
    sw.click();
    expect(rowSwitches()[1]).toBe(sw);
    expect(document.activeElement).toBe(sw);
  });

  // role="switch" does not support aria-checked="mixed" — a user agent reports it as "off", so the
  // half-lit track and the announced state would disagree. A checkbox carries the third state.
  it("exposes the master as a tri-state checkbox, not a switch", () => {
    qc = build();
    qc.open();
    expect(masters().map((m) => m.getAttribute("role"))).toEqual(["checkbox", "checkbox"]);
  });

  it("master switch reads checked while the whole group is on", () => {
    qc = build();
    qc.open();
    expect(masters().map((m) => m.getAttribute("aria-checked"))).toEqual(["true", "true"]);
  });

  it("master switch reads mixed while the group is partly on", () => {
    qc = build();
    expressMotionSettings.setEnabled("sulk", false);
    qc.open();
    expect(masters()[0]!.getAttribute("aria-checked")).toBe("mixed");
  });

  it("master switch reads unchecked while the whole group is off", () => {
    qc = build();
    expressMotionSettings.setAllEnabled(
      ["happy", "laugh", "embarrassed", "sheepish", "calm", "sulk"],
      false,
    );
    qc.open();
    expect(masters()[0]!.getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a fully-on master turns the whole group off", () => {
    qc = build();
    qc.open();
    masters()[1]!.click();
    expect(expressMotionSettings.get().disabled).toEqual(["sleeping", "dance"]);
    expect(masters()[1]!.getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a mixed master turns the whole group on", () => {
    qc = build();
    expressMotionSettings.setEnabled("dance", false);
    qc.open();
    expect(masters()[1]!.getAttribute("aria-checked")).toBe("mixed");
    masters()[1]!.click();
    expect(expressMotionSettings.get().disabled).toEqual([]);
    expect(masters()[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("the master switch leaves other groups alone", () => {
    qc = build();
    qc.open();
    masters()[0]!.click();
    expect(expressMotionSettings.get().disabled).not.toContain("dance");
    expect(masters()[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("reflects a store change made elsewhere (cross-window broadcast)", () => {
    qc = build();
    qc.open();
    expand(1);
    expressMotionSettings.setEnabled("dance", false);
    expect(
      rowSwitches()
        .find((s) => s.dataset.motion === "dance")!
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("hides the section while the motion catalog is unavailable", () => {
    qc = build(() => []);
    qc.open();
    expect(groups()).toEqual([]);
    expect(qc.el.querySelector<HTMLElement>(".yui-express-motion")!.hidden).toBe(true);
  });
});
