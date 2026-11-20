// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScreenKnobSettings } from "../../../../settings/capture/screen-settings";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { countSubscriptions, defaultQcArgs } from "../../test-helpers";

const SCREEN_DEFAULTS = {
  prev_dwell_ms: 600_000,
  settle_ms: 90_000,
  long_session_ms: 2_700_000,
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

  // ── Screen-watch toggle ───────────────────────────────────────────────────

  it("renders no screen-watch section when the flag store is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-screen-switch")).toBeNull();
    expect(qc.el.querySelector("#yui-screen-settle")).toBeNull();
    qc.dispose();
  });

  // A section whose knobs cannot be edited is worse than no section — render neither half alone.
  it("renders no screen-watch section when the knob store is absent", () => {
    const qc = buildQc({ screenSettings: createFlagSettings(false) });
    qc.open();
    expect(qc.el.querySelector(".yui-screen-switch")).toBeNull();
    expect(qc.el.querySelector("#yui-screen-settle")).toBeNull();
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

  it("reflects an external knob edit while open", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    screenKnobSettings.set({ settle_ms: 30_000 });
    expect(qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!.value).toBe("30");
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

  it("carries the footnote about screenshot pixels and do-not-disturb", () => {
    const { qc } = buildScreenQc();
    qc.open();
    const foot = qc.el.querySelector("#yui-panel-react .yui-field-hint")!;
    expect(foot.textContent).toContain("스크린샷");
    expect(foot.textContent).toContain("방해금지");
    qc.dispose();
  });

  // ── Teardown ──────────────────────────────────────────────────────────────

  it("detaches the knob listeners on dispose", () => {
    const { screenKnobSettings, qc } = buildScreenQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-screen-settle")!;
    qc.dispose();

    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screenKnobSettings.get().settle_ms).toBe(0);
  });

  it("releases every flag and knob subscription on dispose", () => {
    const screenSettings = createFlagSettings(false);
    const screenKnobSettings = createScreenKnobSettings();
    const counts = [screenSettings, screenKnobSettings].map(countSubscriptions);
    const { qc } = buildScreenQc({ screenSettings, screenKnobSettings });

    qc.dispose();

    for (const { taken, released } of counts) {
      expect(taken).toBeGreaterThan(0);
      expect(released).toBe(taken);
    }
  });
});
