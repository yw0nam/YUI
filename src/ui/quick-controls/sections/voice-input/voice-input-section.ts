/**
 * Voice input section — owns the voice input switch and the silence threshold (VAD) slider:
 * node queries, the click handler, the slider binding, both store subscriptions, redraws, teardown.
 */

import type { Logger } from "../../../../logger";
import {
  type createVadSettings,
  VAD_SILENCE_MAX,
  VAD_SILENCE_MIN,
} from "../../../../settings/voice/vad-settings";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "../../../chips/voice-input-status";
import { bindSlider } from "../../slider-binding";

type VadSettingsStore = ReturnType<typeof createVadSettings>;

interface VoiceInputSectionDeps {
  /** Panel root (el) — query the voice switch and the VAD slider here; it carries the is-voice-on class. */
  root: HTMLElement;
  /** Voice input state — its subscription repaints the switch whether or not the panel is open. */
  voiceStatus: VoiceInputStatus;
  /** STT silence threshold (ms) store — the slider drives it. */
  vad: VadSettingsStore;
  /** Switch-row redraw — the vad subscription calls it before the slider redraw. */
  reflectSwitchRows: () => void;
  /** Popover open state — the vad subscription redraws only while the panel is open. */
  isOpen: () => boolean;
  /** Logger — the switch click and the slider release report here. */
  log: Logger;
}

interface VoiceInputSection {
  /** Render the voice switch and the slider from their stores. */
  reflect(): void;
  /** Permanent teardown — unsubscribe both stores and remove all listeners. */
  dispose(): void;
}

export function createVoiceInputSection(deps: VoiceInputSectionDeps): VoiceInputSection {
  const { root: el, voiceStatus, vad, reflectSwitchRows, isOpen, log } = deps;

  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const vadSlider = el.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = el.querySelector<HTMLSpanElement>(".yui-vad__value")!;

  vadSlider.min = String(VAD_SILENCE_MIN);
  vadSlider.max = String(VAD_SILENCE_MAX);
  vadSlider.step = "50";

  function reflectVad(): void {
    const ms = vad.get().silenceMs;
    vadSlider.value = String(ms);
    vadValue.textContent = `${ms} ms`;
    vadSlider.style.setProperty(
      "--fill",
      String((ms - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN)),
    );
  }

  function reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void {
    const on = snapshot.state !== "idle";
    voiceSwitchBtn.setAttribute("aria-checked", String(on));
    el.classList.toggle("is-voice-on", on);
  }

  function handleVoiceSwitchClick(): void {
    const current = voiceStatus.get().state !== "idle";
    log.info("voice_input_toggle", { on: !current });
    voiceStatus.set(current ? "idle" : "listening");
  }

  // ── Silence threshold (VAD) slider ──

  const disposeVadSlider = bindSlider(
    {
      slider: vadSlider,
      parse: (raw: string) => parseInt(raw, 10),
      setValue: (v: number) => vad.setSilenceMs(v), // Store subscription calls reflectVad to redraw value row
      logKey: "vad_silence_change",
      logField: "silenceMs",
    },
    log,
  );

  const unsubscribeVoice = voiceStatus.subscribe(reflectVoiceStatus);
  const unsubscribeVad = vad.subscribe(() => {
    if (isOpen()) {
      reflectSwitchRows();
      reflectVad();
    }
  });

  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);

  return {
    reflect(): void {
      reflectVoiceStatus(voiceStatus.get());
      reflectVad();
    },
    dispose(): void {
      unsubscribeVoice();
      unsubscribeVad();
      voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
      disposeVadSlider();
    },
  };
}
