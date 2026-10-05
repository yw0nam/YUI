// @vitest-environment jsdom
/**
 * voice-input-section.test.ts — the voice input switch and the silence slider on the panel's real
 * markup: which redraws follow the panel's open state, and teardown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createVadSettings, VAD_SILENCE_MIN } from "../../../../settings/voice/vad-settings";
import { createVoiceInputStatus } from "../../../chips/voice-input-status";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
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
