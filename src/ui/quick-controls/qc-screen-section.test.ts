// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuardrailsSettings } from "../../io/guardrails-settings";
import { createFlagSettings } from "../../io/persisted-store";
import { createScreenKnobSettings } from "../../io/screen-settings";
import { setLocale } from "../i18n";
import ko from "../i18n/ko";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

const SCREEN_DEFAULTS = {
  prev_dwell_ms: 600_000,
  settle_ms: 90_000,
  long_session_ms: 2_700_000,
  min_gap_ms: 300_000,
  quiet_after_turn_ms: 180_000,
  recent_cap: 5,
};

describe("createQuickControls — proactive tab (screen watch)", () => {
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

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({ ...defaultQcArgs(mount), ...extra });
  }

  function buildScreenQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const screenSettings = createFlagSettings(false);
    const screenKnobSettings = createScreenKnobSettings();
    return {
      screenSettings,
      screenKnobSettings,
      qc: buildQc({
        screenSettings,
        screenKnobSettings,
        getScreenDefaults: () => SCREEN_DEFAULTS,
        ...extra,
      }),
    };
  }

  // ── Tab identity ──────────────────────────────────────────────────────────

  it("names the react tab 말걸기 and tooltips it as the proactive rule hub", () => {
    const qc = buildQc();
    qc.open();
    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    expect(tab.querySelector(".yui-tab__label")!.textContent).toBe("말걸기");
    expect(tab.getAttribute("title")).toBe("유이가 먼저 말을 거는 규칙");
    qc.dispose();
  });

  // ── Cue-section relocation ────────────────────────────────────────────────

  it("mounts the cue-sections block in the proactive tab, not the input tab", () => {
    const qc = buildQc();
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    const cueSections = reactPanel.querySelector(".yui-cue-sections");
    expect(cueSections).not.toBeNull();
    expect(cueSections!.querySelector("[data-testid='cue-section']")).not.toBeNull();
    expect(inputPanel.querySelector(".yui-cue-sections")).toBeNull();
    expect(inputPanel.querySelector(".yui-loop-cue-section")).toBeNull();
    qc.dispose();
  });

  it("keeps the screenshot and voice rows in the input tab", () => {
    const qc = buildQc();
    qc.open();
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    expect(inputPanel.querySelector(".yui-screenshot-switch")).not.toBeNull();
    expect(inputPanel.querySelector(".yui-voice-switch")).not.toBeNull();
    qc.dispose();
  });

  // ── Section order ─────────────────────────────────────────────────────────

  it("orders the proactive tab: screen watch → cues → watchers → shared", () => {
    const { qc } = buildScreenQc({
      rateLimitSettings: createGuardrailsSettings(),
    });
    qc.open();
    const panel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const nodes = Array.from(panel.querySelectorAll("*"));
    const at = (sel: string) => nodes.indexOf(panel.querySelector(sel)!);
    expect(at(".yui-screen-switch")).toBeGreaterThanOrEqual(0);
    expect(at(".yui-screen-switch")).toBeLessThan(at(".yui-loop-cue-section"));
    expect(at(".yui-loop-cue-section")).toBeLessThan(at(".yui-cue-sections"));
    expect(at(".yui-cue-sections")).toBeLessThan(at(".yui-wf-list"));
    expect(at(".yui-wf-list")).toBeLessThan(at("#yui-rate-tier2"));
    qc.dispose();
  });

  // ── Screen-watch toggle ───────────────────────────────────────────────────

  it("renders no screen-watch section when the flag store is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-screen-switch")).toBeNull();
    expect(qc.el.querySelector(".yui-screen-knobs")).toBeNull();
    qc.dispose();
  });

  // A section whose knobs cannot be edited is worse than no section — render neither half alone.
  it("renders no screen-watch section when the knob store is absent", () => {
    const qc = buildQc({ screenSettings: createFlagSettings(false) });
    qc.open();
    expect(qc.el.querySelector(".yui-screen-switch")).toBeNull();
    expect(qc.el.querySelector(".yui-screen-knobs")).toBeNull();
    qc.dispose();
  });

  it("starts off with the knob group hidden", () => {
    const { screenSettings, qc } = buildScreenQc();
    qc.open();
    expect(screenSettings.get().enabled).toBe(false);
    const toggle = qc.el.querySelector<HTMLButtonElement>(".yui-screen-switch")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(qc.el.querySelector<HTMLElement>(".yui-screen-knobs")!.hidden).toBe(true);
    qc.dispose();
  });

  it("reveals the knob group when the toggle is switched on", () => {
    const { screenSettings, qc } = buildScreenQc();
    qc.open();
    qc.el.querySelector<HTMLButtonElement>(".yui-screen-switch")!.click();
    expect(screenSettings.get().enabled).toBe(true);
    expect(qc.el.querySelector<HTMLElement>(".yui-screen-knobs")!.hidden).toBe(false);
    qc.dispose();
  });

  it("hides the knob group again when the toggle is switched off", () => {
    const screenSettings = createFlagSettings(true);
    const { qc } = buildScreenQc({ screenSettings });
    qc.open();
    expect(qc.el.querySelector<HTMLElement>(".yui-screen-knobs")!.hidden).toBe(false);
    qc.el.querySelector<HTMLButtonElement>(".yui-screen-switch")!.click();
    expect(qc.el.querySelector<HTMLElement>(".yui-screen-knobs")!.hidden).toBe(true);
    qc.dispose();
  });

  // ── Knobs ─────────────────────────────────────────────────────────────────

  it("shows the config defaults in display units while nothing is overridden", () => {
    const { qc } = buildScreenQc();
    qc.open();
    const value = (id: string) => qc.el.querySelector<HTMLInputElement>(id)!.value;
    expect(value("#yui-screen-prev-dwell")).toBe("10");
    expect(value("#yui-screen-settle")).toBe("90");
    expect(value("#yui-screen-long-session")).toBe("45");
    expect(value("#yui-screen-quiet")).toBe("3");
    expect(qc.el.querySelector<HTMLInputElement>(".yui-screen-gap__slider")!.value).toBe("5");
    expect(qc.el.querySelector(".yui-screen-gap__value")!.textContent).toBe("5분");
    qc.dispose();
  });

  it("shows the stored override instead of the config default", () => {
    const screenKnobSettings = createScreenKnobSettings();
    screenKnobSettings.set({ settle_ms: 30_000 });
    const { qc } = buildScreenQc({ screenKnobSettings });
    qc.open();
    expect(qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!.value).toBe("30");
    expect(qc.el.querySelector<HTMLInputElement>("#yui-screen-prev-dwell")!.value).toBe("10");
    qc.dispose();
  });

  it("shows recent_cap as a bare count and commits it unconverted", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-recent-cap")!;
    expect(input.value).toBe("5");
    expect(input.min).toBe("0");
    expect(input.max).toBe("20");

    input.value = "3";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().recent_cap).toBe(3);
    expect(input.value).toBe("3");
  });

  it("clamps a typed recent_cap into its 0-20 row bounds", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-recent-cap")!;

    input.value = "50";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().recent_cap).toBe(20);
    expect(input.value).toBe("20");
  });

  it("commits a numeric knob on change, converted to ms", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-long-session")!;
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().long_session_ms).toBe(1_800_000);
    qc.dispose();
  });

  // The row advertises its bounds via min/max, which the browser only enforces on the spinner —
  // a typed value has to be clamped at the commit site or the producer runs outside the advertised range.
  it("clamps a typed knob into the range its row advertises", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!;
    input.value = "5000"; // row max is 600 s
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(600_000);
    expect(input.value).toBe("600");

    input.value = "2"; // row min is 5 s
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(5_000);
    qc.dispose();
  });

  it("clears the override when the knob is emptied, falling back to the config default", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!;
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(30_000);

    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(0);
    expect(input.value).toBe("90");
    qc.dispose();
  });

  it("does not commit a numeric knob on every keystroke", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    const setSpy = vi.spyOn(screenKnobSettings, "set");
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!;
    input.focus();
    for (const partial of ["3", "30"]) {
      input.value = partial;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(setSpy).not.toHaveBeenCalled();
    expect(screenKnobSettings.get().settle_ms).toBe(0);

    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(30_000);
    qc.dispose();
  });

  it("tracks the min-gap slider live but commits only on release", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const slider = qc.el.querySelector<HTMLInputElement>(".yui-screen-gap__slider")!;
    // 0 is the store's "no override" sentinel, so the lowest reachable position is 1 —
    // a thumb that snapped back to the config default on release would be a lie.
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("60");

    slider.value = "12";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(qc.el.querySelector(".yui-screen-gap__value")!.textContent).toBe("12분");
    expect(screenKnobSettings.get().min_gap_ms).toBe(0);

    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().min_gap_ms).toBe(720_000);
    qc.dispose();
  });

  it("keeps the thumb where it was released at the lowest position", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const slider = qc.el.querySelector<HTMLInputElement>(".yui-screen-gap__slider")!;
    slider.value = "1";
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().min_gap_ms).toBe(60_000);
    expect(slider.value).toBe("1");
    expect(qc.el.querySelector(".yui-screen-gap__value")!.textContent).toBe("1분");
    qc.dispose();
  });

  it("carries the footnote about screenshot pixels and do-not-disturb", () => {
    const { qc } = buildScreenQc();
    qc.open();
    const foot = qc.el.querySelector(".yui-screen-knobs .yui-field-hint")!;
    expect(foot.textContent).toContain("스크린샷");
    expect(foot.textContent).toContain("방해금지");
    qc.dispose();
  });

  // ── `?` hint buttons ──────────────────────────────────────────────────────

  it("puts a `?` hint on the screen-watch and rate-cap section labels", () => {
    const { qc } = buildScreenQc({ rateLimitSettings: createGuardrailsSettings() });
    qc.open();
    const hints = Array.from(qc.el.querySelectorAll<HTMLElement>("#yui-panel-react .yui-hint-dot"));
    expect(hints).toHaveLength(2);
    for (const hint of hints) {
      expect(hint.textContent).toBe("?");
      // `title` fires the OS tooltip a second time on top of ours — must not be present.
      expect(hint.hasAttribute("title")).toBe(false);
      // The explanation itself must be the accessible name — a keyboard user has no hover to fall back to.
      expect(hint.getAttribute("aria-label")!.length).toBeGreaterThan(20);
      // Click toggles the tooltip, so it announces itself as actionable — but stays a <span>.
      expect(hint.getAttribute("role")).toBe("button");
      expect(hint.tagName).not.toBe("BUTTON");
      expect(hint.tabIndex).toBe(0);
    }
    qc.dispose();
  });

  it("escapes a double quote and ampersand in the hint text so the markup can't break", () => {
    const original = ko["screen.hint"];
    ko["screen.hint"] = 'Say "hi" & bye';
    try {
      const { qc } = buildScreenQc();
      qc.open();
      const hint = qc.el.querySelector<HTMLElement>("#yui-panel-react .yui-hint-dot")!;
      expect(hint.getAttribute("aria-label")).toBe('Say "hi" & bye');
      qc.dispose();
    } finally {
      ko["screen.hint"] = original;
    }
  });

  // ── Teardown ──────────────────────────────────────────────────────────────

  it("detaches the knob and slider listeners on dispose", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!;
    const slider = qc.el.querySelector<HTMLInputElement>(".yui-screen-gap__slider")!;
    qc.dispose();

    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    slider.value = "12";
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(0);
    expect(screenKnobSettings.get().min_gap_ms).toBe(0);
  });
});
