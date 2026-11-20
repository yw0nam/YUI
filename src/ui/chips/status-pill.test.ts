// @vitest-environment jsdom
/**
 * The status pill: the capture, voice and tool tells in one pill at the top of the character
 * window. It draws the state its three sources report and decides nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./status-pill.css", () => ({}));

import { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { setLocale, t } from "../i18n";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../surfaces/interactive-overlay";
import { createStatusPill } from "./status-pill";
import type { TurnNotice } from "./turn-notice";
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

function fakeNotice() {
  let current: TurnNotice | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set(next: TurnNotice | null) {
      current = next;
      for (const cb of listeners) cb();
    },
    clear() {
      this.set(null);
    },
  };
}

function setup(
  opts: {
    capture?: boolean;
    withCaptureSetting?: boolean;
    withToggle?: boolean;
    withMicSettings?: boolean;
    dnd?: ReturnType<typeof createFlagSettings>;
  } = {},
) {
  const dnd = opts.dnd;
  const notice = fakeNotice();
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const settings = createScreenshotSettings();
  settings.setEnabled(opts.capture ?? false);
  const voice = createVoiceInputStatus();
  const onOpenSettings = vi.fn();
  const onToggleVoice = vi.fn();
  const onOpenMicSettings = vi.fn();
  const pill = createStatusPill({
    ...(opts.withCaptureSetting === false ? {} : { settings }),
    mount,
    voice,
    onOpenSettings,
    notice,
    ...(opts.withToggle ? { onToggleVoice } : {}),
    ...(opts.withMicSettings ? { onOpenMicSettings } : {}),
    ...(dnd
      ? {
          dnd: {
            get: () => dnd.get().enabled,
            subscribe: (cb: () => void) => dnd.subscribe(() => cb()),
          },
        }
      : {}),
  });
  flushFrames();
  const q = <T extends Element>(sel: string): T => mount.querySelector<T>(sel)!;
  return {
    mount,
    settings,
    voice,
    pill,
    onOpenSettings,
    onToggleVoice,
    onOpenMicSettings,
    notice,
    action: () => mount.querySelector<HTMLButtonElement>(".yui-status__action"),
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

describe("status pill — do-not-disturb", () => {
  it("shows a still Do not disturb segment while DND is on, and hides with nothing else once it is off", () => {
    const dnd = createFlagSettings(true);
    const p = setup({ dnd });

    expect(p.root().hidden).toBe(false);
    expect(p.mount.querySelector(".yui-status__dnd")!.textContent).toBe("Do not disturb");
    expectSegmentHidden(p);

    dnd.setEnabled(false);
    opacityTransitionEnd(p.root());
    expect(p.root().hidden).toBe(true);
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
  });

  it("takes OS clicks on the capture button only while capture is on, from the start of the fade", () => {
    const p = setup({ capture: true });
    expect(p.matchAny()).toBe(p.capture());

    p.settings.setEnabled(false);
    expect(p.root().hidden).toBe(false);
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

  it("stays click-through while no notice offers an action", () => {
    const p = setup();
    for (const [state, detail] of [
      ["error", "network_drop"],
      ["listening", undefined],
      ["asr", undefined],
      ["fired", undefined],
    ] as const) {
      p.voice.set(state, detail);
      expect(p.matchAny()).toBeNull();
    }

    p.root().click();
    p.mic().click();
    expect(p.onOpenSettings).not.toHaveBeenCalled();
    expect(p.voice.get()).toMatchObject({ state: "fired" });
  });
});

describe("status pill — voice error with the server's message", () => {
  it("reads the message in place of the state label", () => {
    const p = setup();
    p.voice.set("error", "network_drop", "rate limit reached");

    expect(p.dot().dataset.voice).toBe("error");
    expect(p.label().textContent).toBe("rate limit reached");
    expect(p.root().dataset.message).toBe("true");
  });

  it("marks only the message label, not the state labels", () => {
    const p = setup();
    p.voice.set("error", "network_drop");
    expect(p.root().dataset.message).toBeUndefined();

    p.voice.set("error", "network_drop", "rate limit reached");
    p.voice.set("listening");
    expect(p.root().dataset.message).toBeUndefined();
  });

  it("goes back to the state label when the next state carries no message", () => {
    const p = setup();
    p.voice.set("error", "network_drop", "rate limit reached");
    p.voice.set("listening");

    expect(p.label().textContent).toBe(t("voice.state.listening"));
  });
});

describe("status pill — mic cause labels", () => {
  it.each([
    ["mic_denied", "Mic blocked"],
    ["no_mic", "No mic"],
    ["mic_unavailable", "Mic unavailable"],
  ])("shows the %s cause as %s and keeps it plain text", (code, label) => {
    const p = setup();
    p.voice.set("error", code);

    expect(p.label().textContent).toBe(label);
    expect(p.mic().getAttribute("aria-label")).toBe(t("aria.voice_input", { label }));
    expect(p.dot().dataset.voice).toBe("error");
  });

  it("localizes the cause", () => {
    const p = setup();
    p.voice.set("error", "mic_denied");

    setLocale("ko");

    expect(p.label().textContent).toBe(t("voice.error.mic_denied"));
    expect(p.label().textContent).not.toBe("Mic blocked");
  });
});

describe("status pill — Open mic settings", () => {
  it("offers the action beside Mic blocked and opens the pane without touching the mic", () => {
    const p = setup({ withMicSettings: true });
    p.voice.set("error", "mic_denied");
    flushFrames();

    expect(p.label().textContent).toBe("Mic blocked");
    expect(p.action()?.textContent).toBe("Open mic settings");
    expect(p.matchAny()).toBe(p.action());
    p.action()!.click();

    expect(p.onOpenMicSettings).toHaveBeenCalledTimes(1);
    expect(p.voice.get()).toMatchObject({ state: "error", detail: "mic_denied" });
  });

  it.each(["no_mic", "mic_unavailable"])("offers nothing beside %s", (code) => {
    const p = setup({ withMicSettings: true });
    p.voice.set("error", code);

    expect(p.action()?.hidden).toBe(true);
    expect(p.matchAny()).toBeNull();
  });

  it("offers nothing without the opener, which only the desktop app on macOS gets", () => {
    const p = setup();
    p.voice.set("error", "mic_denied");

    expect(p.label().textContent).toBe("Mic blocked");
    expect(p.action()?.hidden).toBe(true);
  });
});

describe("status pill — voice toggle", () => {
  it("calls onToggleVoice from the mic button while the voice is live", () => {
    const p = setup({ withToggle: true });
    p.voice.set("listening");

    p.label().click();
    expect(p.onToggleVoice).not.toHaveBeenCalled();

    p.mic().click();

    expect(p.onToggleVoice).toHaveBeenCalledTimes(1);
    expect(p.mic().tabIndex).toBe(0);
  });

  it("does nothing on a mic click without the option", () => {
    const p = setup();
    p.voice.set("listening");

    p.mic().click();

    expect(p.onToggleVoice).not.toHaveBeenCalled();
    expect(p.mic().tabIndex).toBe(-1);
  });
});

describe("status pill — no capture setting", () => {
  it("renders no capture button at all", () => {
    const p = setup({ withCaptureSetting: false });
    p.voice.set("listening");

    expect(p.mount.querySelector(".yui-status__capture")).toBeNull();
    expect(p.mic().hidden).toBe(false);
    expect(p.sep().hidden).toBe(false);
  });
});

describe("status pill — failed-turn notice", () => {
  it("shows the condition and its action as a button that takes OS clicks", () => {
    const p = setup();
    const onClick = vi.fn();

    p.notice.set({
      message: "Auth failed · check API key",
      action: { label: "Change key", onClick },
    });
    flushFrames();

    expect(p.root().hidden).toBe(false);
    expect(p.label().textContent).toBe("Auth failed · check API key");
    expect(p.action()?.textContent).toBe("Change key");
    expect(p.action()?.type).toBe("button");
    expect(p.matchAny()).toBe(p.action());
    p.action()!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("clicking the notice's action clears the notice", () => {
    const p = setup();
    const onClick = vi.fn();
    p.notice.set({
      message: "400 Please pass a valid API key",
      action: { label: "Check connection", onClick },
    });
    flushFrames();

    p.action()!.click();

    expect(onClick).toHaveBeenCalledOnce();
    expect(p.notice.get()).toBeNull();
    expect(p.matchAny()).toBeNull();
  });

  it("shows a notice with no action as plain text that stays click-through", () => {
    const p = setup();

    p.notice.set({ message: "No response · check connection" });

    expect(p.label().textContent).toBe("No response · check connection");
    expect(p.action()?.hidden).toBe(true);
    expect(p.matchAny()).toBeNull();
  });

  it("leaves the mic's state alone and gives the label back when the notice goes", () => {
    const p = setup();
    p.voice.set("listening");

    p.notice.set({ message: "Auth failed · check API key" });
    expect(p.label().textContent).toBe("Auth failed · check API key");
    expect(p.voice.get().state).toBe("listening");
    expect(p.mic().dataset.voice).toBe("listening");

    p.notice.set(null);
    expect(p.label().textContent).toBe("Listening…");
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
    p.voice.set("error", "network_drop");
    p.pill.showTool("web_search");

    expect(p.label().textContent).toBe("Searching…");
    expect(p.dot().dataset.tool).toBe("running");
    expect(p.dot().dataset.voice).toBeUndefined();
    expect(p.mic().hidden).toBe(false);
    expect(p.mic().dataset.voice).toBe("error");
    expect(p.sep().hidden).toBe(false);
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

  it("finishTool(true) marks the segment failed and holds it like done", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = setup({ capture: true });
    p.pill.showTool("body_action");
    flushFrames();
    p.pill.finishTool(true);

    expect(p.dot().dataset.tool).toBe("failed");
    expect(p.label().textContent).toBe("Body action…");
    vi.advanceTimersByTime(1499);
    expect(p.dot().dataset.tool).toBe("failed");
    vi.advanceTimersByTime(1);

    expect(p.root().hidden).toBe(false);
    expect(p.capture().hidden).toBe(false);
    expectSegmentHidden(p);
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
    const root = p.root();
    const dot = p.dot();
    p.pill.showTool("web_search");
    p.pill.finishTool();
    p.pill.dispose();
    p.pill.showTool("terminal");
    vi.advanceTimersByTime(2600);

    expect(dot.dataset.tool).toBe("done");
    expect(root.isConnected).toBe(false);
  });
});
