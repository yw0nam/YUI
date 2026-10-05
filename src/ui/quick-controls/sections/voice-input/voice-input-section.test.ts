// @vitest-environment jsdom
// Voice-input behavior on panel markup and through the whole panel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import { createFlagSettings } from "../../../../settings/persisted-store";
import {
  createVadSettings,
  VAD_SILENCE_DEFAULT,
  VAD_SILENCE_MIN,
} from "../../../../settings/voice/vad-settings";
import { createVoiceInputStatus } from "../../../chips/voice-input-status";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { defaultQcArgs } from "../../test-helpers";
import { createVoiceInputSection } from "./voice-input-section";

function build() {
  const voiceStatus = createVoiceInputStatus();
  const vad = createVadSettings();
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: false,
    hasSession: false,
    switchRows: createSwitchRows({ idleThrottleSettings: createFlagSettings(false), vad }),
    showScreen: false,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: false,
    showHelp: false,
    showMessage: false,
    showHistory: false,
  });
  document.body.append(root);
  let open = true;
  const section = createVoiceInputSection({
    root,
    voiceStatus,
    vad,
    reflectSwitchRows: () => {},
    isOpen: () => open,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger,
  });
  return {
    root,
    voiceStatus,
    vad,
    section,
    setOpen: (next: boolean) => {
      open = next;
    },
  };
}

describe("createVoiceInputSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    vi.restoreAllMocks();
  });

  it("repaints the voice switch while closed and the slider only while open", () => {
    const { root, voiceStatus, vad, setOpen } = build();
    const slider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
    setOpen(false);
    vad.setSilenceMs(VAD_SILENCE_MIN + 100);
    expect(slider.value).not.toBe(String(VAD_SILENCE_MIN + 100));
    voiceStatus.set("listening");
    expect(root.querySelector(".yui-voice-switch")!.getAttribute("aria-checked")).toBe("true");
    setOpen(true);
    vad.setSilenceMs(VAD_SILENCE_MIN + 200);
    expect(slider.value).toBe(String(VAD_SILENCE_MIN + 200));
  });

  it("reflect() repaints the voice switch and the slider from their stores", () => {
    const { root, voiceStatus, vad, section, setOpen } = build();
    const slider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
    const voiceSwitch = root.querySelector(".yui-voice-switch")!;
    setOpen(false);
    voiceStatus.set("listening");
    vad.setSilenceMs(VAD_SILENCE_MIN + 100);
    voiceSwitch.setAttribute("aria-checked", "false");

    section.reflect();

    expect(voiceSwitch.getAttribute("aria-checked")).toBe("true");
    expect(slider.value).toBe(String(VAD_SILENCE_MIN + 100));
  });

  it("dispose stops the redraws, the switch click and the slider input", () => {
    const { root, voiceStatus, vad, section } = build();
    const slider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
    section.dispose();
    voiceStatus.set("listening");
    expect(root.querySelector(".yui-voice-switch")!.getAttribute("aria-checked")).toBe("false");
    vad.setSilenceMs(VAD_SILENCE_MIN + 200);
    expect(slider.value).not.toBe(String(VAD_SILENCE_MIN + 200));
    voiceStatus.set("idle");
    root.querySelector<HTMLButtonElement>(".yui-voice-switch")!.click();
    expect(voiceStatus.get().state).toBe("idle");
    const before = vad.get().silenceMs;
    slider.value = String(VAD_SILENCE_MIN + 300);
    slider.dispatchEvent(new Event("input"));
    expect(vad.get().silenceMs).toBe(before);
  });
});

describe("createQuickControls — voice silence slider", () => {
  let mount: HTMLElement;
  let vad: ReturnType<typeof createVadSettings>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    vad = createVadSettings();
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      vad,
      ...extra,
    });
  }

  // ── Silence threshold (VAD) slider — Input tab ──────────────────────────────

  it("renders the silence-window slider with min 500 / max 3000 / step 50", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    );
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("500");
    expect(slider!.max).toBe("3000");
    expect(slider!.step).toBe("50");

    qc.dispose();
  });

  it("reflects the vad store value (default 1500 ms) on the readout", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    )!;
    expect(slider.value).toBe(String(VAD_SILENCE_DEFAULT));
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("1500 ms");

    qc.dispose();
  });

  it("dragging the slider calls vad.setSilenceMs and updates the readout", () => {
    const setSpy = vi.spyOn(vad, "setSilenceMs");
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    )!;
    slider.value = "2000";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setSpy).toHaveBeenCalledWith(2000);
    expect(vad.get().silenceMs).toBe(2000);
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("2000 ms");

    qc.dispose();
  });

  it("does NOT render the legacy voice details (세부 설정) block", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-voice-details")).toBeNull();
    expect(qc.el.querySelector(".yui-voice-status")).toBeNull();
    expect(qc.el.querySelector(".yui-setting-grid")).toBeNull();
    qc.dispose();
  });
});
