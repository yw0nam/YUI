// @vitest-environment jsdom
/**
 * The status pill: the capture, voice and tool tells in one pill at the top of the character
 * window. It draws the state its three sources report and decides nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./status-pill.css", () => ({}));

import { INTERACTIVE_OVERLAY_SELECTORS } from "../../app/stage/wire-stage";
import { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { setLocale, t } from "../i18n";
import { createStatusPill } from "./status-pill";
import { createVoiceInputStatus } from "./voice-input-status";

const pending = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function flushFrames(): void {
  for (const cb of [...pending.values()]) cb(0);
  pending.clear();
}

function opacityTransitionEnd(el: HTMLElement): void {
  el.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));
}

function setup(opts: { capture?: boolean } = {}) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const settings = createScreenshotSettings();
  settings.setEnabled(opts.capture ?? false);
  const voice = createVoiceInputStatus();
  const onOpenSettings = vi.fn();
  const onFixVoice = vi.fn();
  const pill = createStatusPill({ mount, settings, voice, onOpenSettings, onFixVoice });
  flushFrames();
  const q = <T extends Element>(sel: string): T => mount.querySelector<T>(sel)!;
  return {
    mount,
    settings,
    voice,
    pill,
    onOpenSettings,
    onFixVoice,
    root: () => q<HTMLElement>(".yui-status"),
    capture: () => q<HTMLButtonElement>(".yui-status__capture"),
    mic: () => q<HTMLButtonElement>(".yui-status__voice"),
    sep: () => q<HTMLElement>(".yui-status__sep"),
    dot: () => q<HTMLElement>(".yui-status__dot"),
    label: () => q<HTMLElement>(".yui-status__label"),
    matchAny: (): Element | null => {
      for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
        const el = mount.querySelector(selector);
        if (el) return el;
      }
      return null;
    },
  };
}

type Pill = ReturnType<typeof setup>;

function expectSegmentHidden(p: Pill): void {
  expect(p.sep().hidden).toBe(true);
  expect(p.dot().hidden).toBe(true);
  expect(p.label().hidden).toBe(true);
}

beforeEach(() => {
  pending.clear();
  nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  setLocale("en");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLocale("en");
});

describe("status pill — nothing to report", () => {
  it("stays hidden with capture off, voice idle and no tool", () => {
    const p = setup();
    expect(p.root().hidden).toBe(true);
    expect(p.root().getAttribute("role")).toBe("status");
    expect(p.root().getAttribute("aria-live")).toBe("polite");
  });
});

describe("status pill — capture only", () => {
  it("shows the capture button alone, named by the watching label", () => {
    const p = setup({ capture: true });

    expect(p.root().hidden).toBe(false);
    expect(p.root().classList.contains("is-visible")).toBe(true);
    expect(p.capture().hidden).toBe(false);
    expect(p.capture().getAttribute("aria-label")).toBe(t("capture.watching"));
    expect(p.capture().querySelector(".yui-status__capture-dot")).not.toBeNull();
    expect(p.mic().hidden).toBe(true);
    expectSegmentHidden(p);
  });

  it("opens settings from the capture button", () => {
    const p = setup({ capture: true });
    p.capture().click();
    expect(p.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(p.onFixVoice).not.toHaveBeenCalled();
  });

  it("takes OS clicks on the capture button only while capture is on", () => {
    const p = setup({ capture: true });
    expect(p.matchAny()).toBe(p.capture());

    p.settings.setEnabled(false);
    opacityTransitionEnd(p.root());
    expect(p.matchAny()).toBeNull();
  });

  it("leaves the a11y tree only once the fade-out settles", () => {
    const p = setup({ capture: true });

    p.settings.setEnabled(false);
    expect(p.root().classList.contains("is-visible")).toBe(false);
    expect(p.root().hidden).toBe(false);

    opacityTransitionEnd(p.root());
    expect(p.root().hidden).toBe(true);

    p.settings.setEnabled(true);
    expect(p.root().hidden).toBe(false);
  });
});

describe("status pill — voice", () => {
  it("shows the mic, separator, dot and the state label for each visible state", () => {
    const p = setup();
    for (const state of ["listening", "asr", "fired", "error"] as const) {
      p.voice.set(state);
      expect(p.root().hidden).toBe(false);
      expect(p.mic().hidden).toBe(false);
      expect(p.sep().hidden).toBe(false);
      expect(p.dot().hidden).toBe(false);
      expect(p.dot().dataset.voice).toBe(state);
      expect(p.label().hidden).toBe(false);
      expect(p.label().textContent).toBe(t(`voice.state.${state}`));
      expect(p.mic().getAttribute("aria-label")).toBe(
        t("aria.voice_input", { label: t(`voice.state.${state}`) }),
      );
    }
  });

  it("re-renders its labels when the locale changes without a remount", () => {
    const p = setup({ capture: true });
    p.voice.set("listening");

    setLocale("ko");

    expect(p.label().textContent).toBe(t("voice.state.listening"));
    expect(p.capture().getAttribute("aria-label")).toBe(t("capture.watching"));
  });

  it("stays click-through outside the settings-fixable error", () => {
    const p = setup();
    for (const [state, detail] of [
      ["error", "network_drop"],
      ["listening", undefined],
      ["asr", undefined],
      ["fired", undefined],
    ] as const) {
      p.voice.set(state, detail);
      expect(p.root().dataset.fix).toBeUndefined();
      expect(p.matchAny()).toBeNull();
    }

    p.root().click();
    p.mic().click();
    expect(p.onFixVoice).not.toHaveBeenCalled();
    expect(p.onOpenSettings).not.toHaveBeenCalled();
    expect(p.voice.get()).toMatchObject({ state: "fired" });
  });
});

describe("status pill — not_configured voice error", () => {
  it("turns the label into the fix link with the gear glyph", () => {
    const p = setup();
    p.voice.set("error", "not_configured");

    expect(p.root().dataset.fix).toBe("settings");
    expect(p.dot().dataset.voice).toBe("error");
    expect(p.label().textContent).toBe(t("voice.error.not_configured"));
    expect(p.mount.querySelector(".yui-status__fix-glyph")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(p.mic().getAttribute("aria-label")).toBe(
      t("aria.voice_input", { label: t("voice.error.not_configured_fix") }),
    );
  });

  it("takes OS clicks on the whole pill", () => {
    const p = setup();
    p.voice.set("error", "not_configured");
    expect(p.matchAny()).toBe(p.root());
  });

  it("calls onFixVoice from a pill click and hands the pill back to listening", () => {
    const p = setup();
    p.voice.set("error", "not_configured");

    p.label().click();

    expect(p.onFixVoice).toHaveBeenCalledTimes(1);
    expect(p.onOpenSettings).not.toHaveBeenCalled();
    expect(p.voice.get().state).toBe("listening");
    expect(p.root().dataset.fix).toBeUndefined();
  });

  it("keeps the capture button on its own action while the fix shows", () => {
    const p = setup({ capture: true });
    p.voice.set("error", "not_configured");

    p.capture().click();

    expect(p.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(p.onFixVoice).not.toHaveBeenCalled();
  });

  it("drops the fix when a transient error replaces it", () => {
    const p = setup();
    p.voice.set("error", "not_configured");
    p.voice.set("error", "network_drop");

    expect(p.root().dataset.fix).toBeUndefined();
    expect(p.label().textContent).toBe(t("voice.state.error"));
  });
});

describe("status pill — tool running", () => {
  it("shows the pulsing ash dot and the tool label", () => {
    const p = setup();
    p.pill.showTool("web_search");
    flushFrames();

    expect(p.root().hidden).toBe(false);
    expect(p.root().classList.contains("is-visible")).toBe(true);
    expect(p.dot().hidden).toBe(false);
    expect(p.dot().dataset.tool).toBe("running");
    expect(p.dot().dataset.voice).toBeUndefined();
    expect(p.label().textContent).toBe("Searching…");
    expect(p.sep().hidden).toBe(true);
  });

  it("overrides the voice label while the mic keeps showing the voice state", () => {
    const p = setup();
    p.voice.set("error", "not_configured");
    p.pill.showTool("web_search");

    expect(p.label().textContent).toBe("Searching…");
    expect(p.dot().dataset.tool).toBe("running");
    expect(p.dot().dataset.voice).toBeUndefined();
    expect(p.mic().hidden).toBe(false);
    expect(p.mic().dataset.voice).toBe("error");
    expect(p.sep().hidden).toBe(false);
    expect(p.root().dataset.fix).toBeUndefined();
  });
});

describe("status pill — tool done", () => {
  it("turns the dot into the check and keeps the tool label", () => {
    const p = setup();
    p.pill.showTool("web_search");
    p.pill.finishTool();

    expect(p.dot().dataset.tool).toBe("done");
    expect(p.label().textContent).toBe("Searching…");
  });

  it("holds done for 1500ms, then falls back to the capture-only pill", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup({ capture: true });
    p.pill.showTool("web_search");
    flushFrames();
    p.pill.finishTool();

    vi.advanceTimersByTime(1499);
    expect(p.dot().dataset.tool).toBe("done");
    vi.advanceTimersByTime(1);

    expect(p.root().hidden).toBe(false);
    expect(p.capture().hidden).toBe(false);
    expectSegmentHidden(p);
  });

  it("falls back to the voice segment when the voice is live", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.voice.set("listening");
    p.pill.showTool("web_search");
    p.pill.finishTool();
    vi.advanceTimersByTime(1500);

    expect(p.dot().dataset.tool).toBeUndefined();
    expect(p.dot().dataset.voice).toBe("listening");
    expect(p.label().textContent).toBe(t("voice.state.listening"));
  });

  it("hides the pill after the hold when nothing else is reported", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.pill.showTool("web_search");
    flushFrames();
    p.pill.finishTool();

    vi.advanceTimersByTime(1500);
    expect(p.root().classList.contains("is-visible")).toBe(false);
    opacityTransitionEnd(p.root());
    expect(p.root().hidden).toBe(true);
  });

  it("hideTool clears the tool segment at once", () => {
    const p = setup({ capture: true });
    p.pill.showTool("web_search");
    p.pill.hideTool();

    expect(p.dot().dataset.tool).toBeUndefined();
    expectSegmentHidden(p);
  });

  it("finishTool is a no-op with no tool showing", () => {
    const p = setup();
    p.pill.finishTool();
    expect(p.dot().dataset.tool).toBeUndefined();
    expect(p.root().hidden).toBe(true);
  });

  it("a re-show during the done hold keeps the pill running", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.pill.showTool("web_search");
    flushFrames();
    p.pill.finishTool();
    vi.advanceTimersByTime(1000);

    p.pill.showTool("terminal");
    vi.advanceTimersByTime(1500);
    flushFrames();

    expect(p.dot().dataset.tool).toBe("running");
    expect(p.label().textContent).toBe("Running…");
    expect(p.root().hidden).toBe(false);
    expect(p.root().classList.contains("is-visible")).toBe(true);
  });

  it("a re-show while the dismiss fade is in flight is not hidden by the stale settle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.pill.showTool("web_search");
    flushFrames();
    p.pill.finishTool();
    vi.advanceTimersByTime(1500);

    p.pill.showTool("terminal");
    vi.advanceTimersByTime(900);
    flushFrames();

    expect(p.root().hidden).toBe(false);
    expect(p.root().classList.contains("is-visible")).toBe(true);
  });

  it("never re-shows the pill from a frame deferred past the hide", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.pill.showTool("web_search");
    p.pill.hideTool();
    vi.advanceTimersByTime(900);
    flushFrames();

    expect(p.root().classList.contains("is-visible")).toBe(false);
    expect(p.root().hidden).toBe(true);
  });
});

describe("status pill — teardown", () => {
  it("stops a pending done hold from mutating the pill after dispose", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup();
    p.pill.showTool("web_search");
    p.pill.finishTool();
    p.pill.dispose();
    p.pill.showTool("terminal");
    vi.advanceTimersByTime(2600);

    expect(p.dot().dataset.tool).toBe("done");
    expect(p.root().isConnected).toBe(false);
  });
});

describe("status pill — reduced motion", () => {
  it("never sets an animation inline, leaving motion to the stylesheet", () => {
    const p = setup({ capture: true });
    p.voice.set("listening");
    p.pill.showTool("web_search");
    p.pill.finishTool();
    flushFrames();

    for (const el of [p.root(), ...p.root().querySelectorAll<HTMLElement>("*")]) {
      expect(el.style.animation).toBe("");
    }
  });
});
