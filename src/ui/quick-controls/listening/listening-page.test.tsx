// @vitest-environment jsdom
/**
 * listening-page.test.tsx — the Listening page renders the voice switch, the STT key, the silence
 * slider, the barge-in and bubble switches and the reading dictionary, and drives their stores.
 */

import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger";
import { createSttKeySettings } from "../../../settings/backend/api-key-settings";
import { createReadingsSettings } from "../../../settings/voice/readings-settings";
import {
  createVadSettings,
  VAD_SILENCE_DEFAULT,
  VAD_SILENCE_MIN,
} from "../../../settings/voice/vad-settings";
import { createVoiceInputStatus } from "../../chips/voice-input-status";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs, inMemoryApiKeyStorage, pressSlider } from "../test-helpers";
import { createListeningPage } from "./listening-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: ReturnType<typeof createListeningPage>[] = [];

function build({ showVoiceInput = true }: { showVoiceInput?: boolean } = {}) {
  const voiceStatus = createVoiceInputStatus();
  const vad = createVadSettings({ storage: { load: () => null, save: () => {} } });
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
  const page = createListeningPage({
    showVoiceInput,
    voiceStatus,
    vad,
    sttKeySettings,
    readingsSettings: createReadingsSettings({
      storage: { load: () => ({ text: "" }), save: () => {} },
    }),
    log,
    host: document.body,
  });
  pages.push(page);
  return {
    page,
    log,
    voiceStatus,
    vad,
    sttKeySettings,
    voiceSwitch: page.el.querySelector<HTMLButtonElement>(".yui-voice-switch"),
    keyInput: page.el.querySelector<HTMLInputElement>(".yui-chatkey__input")!,
    slider: page.el.querySelector<HTMLInputElement>(".yui-vad__slider input")!,
  };
}

function close(page: ReturnType<typeof createListeningPage>): void {
  act(() => page.dispose());
  pages.splice(pages.indexOf(page), 1);
}

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
  setLocale("en");
  vi.restoreAllMocks();
});

describe("createListeningPage — voice input", () => {
  it("the voice switch and the silence slider follow their stores", () => {
    const { page, voiceStatus, vad, slider } = build();

    act(() => voiceStatus.set("listening"));
    expect(page.el.querySelector(".yui-voice-switch")!.getAttribute("aria-checked")).toBe("true");

    act(() => vad.setSilenceMs(VAD_SILENCE_MIN + 200));
    expect(slider.value).toBe(String(VAD_SILENCE_MIN + 200));
  });

  it("dispose stops the store following, the switch click and the slider input", () => {
    const { page, voiceStatus, vad, voiceSwitch, slider } = build();
    close(page);

    act(() => voiceStatus.set("listening"));
    expect(voiceSwitch!.getAttribute("aria-checked")).toBe("false");

    act(() => vad.setSilenceMs(VAD_SILENCE_MIN + 200));
    expect(slider.value).not.toBe(String(VAD_SILENCE_MIN + 200));

    act(() => voiceStatus.set("idle"));
    voiceSwitch!.click();
    expect(voiceStatus.get().state).toBe("idle");

    const before = vad.get().silenceMs;
    fireEvent.change(slider, { target: { value: String(VAD_SILENCE_MIN + 300) } });
    expect(vad.get().silenceMs).toBe(before);
  });
});

describe("createListeningPage — voice silence slider", () => {
  beforeEach(() => setLocale("ko"));

  function sliderOf(page: ReturnType<typeof createListeningPage>): HTMLInputElement {
    return within(page.el).getByRole<HTMLInputElement>("slider", { name: "침묵 기준" });
  }

  it("renders the silence-window slider with min 500 / max 3000 / step 50", () => {
    const { page } = build();

    const slider = sliderOf(page);
    expect(slider).not.toBeNull();
    expect(slider.min).toBe("500");
    expect(slider.max).toBe("3000");
    expect(slider.step).toBe("50");
  });

  it("reflects the vad store value (default 1500 ms) on the readout", () => {
    const { page } = build();

    const slider = sliderOf(page);
    expect(slider.value).toBe(String(VAD_SILENCE_DEFAULT));
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("1500 ms");
  });

  it("dragging the slider calls vad.setSilenceMs, updates the readout and logs the commit", () => {
    const { page, vad, log } = build();
    const setSpy = vi.spyOn(vad, "setSilenceMs");

    const slider = sliderOf(page);
    fireEvent.change(slider, { target: { value: "2000" } });

    expect(setSpy).toHaveBeenCalledWith(2000);
    expect(log.info).toHaveBeenCalledWith("vad_silence_change", { silenceMs: 2000 });
    expect(vad.get().silenceMs).toBe(2000);
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("2000 ms");
  });

  it("does NOT render the legacy voice details (세부 설정) block", () => {
    const { page } = build();
    expect(page.el.querySelector(".yui-voice-details")).toBeNull();
    expect(page.el.querySelector(".yui-voice-status")).toBeNull();
    expect(page.el.querySelector(".yui-setting-grid")).toBeNull();
  });

  it("retains a working silence slider without a voice switch", () => {
    const { page, vad, voiceSwitch } = build({ showVoiceInput: false });
    expect(voiceSwitch).toBeNull();

    const slider = sliderOf(page);
    fireEvent.change(slider, { target: { value: "2000" } });
    expect(vad.get().silenceMs).toBe(2000);
  });
});

describe("createListeningPage — STT key row", () => {
  it("holds a typed draft until blur, then shows the stored, trimmed value", () => {
    const { sttKeySettings, keyInput } = build();

    fireEvent.input(keyInput, { target: { value: " sk-a " } });
    expect(sttKeySettings.get().apiKey).toBe("");

    fireEvent.blur(keyInput);
    expect(sttKeySettings.get().apiKey).toBe("sk-a");
    expect(keyInput.value).toBe("sk-a");
  });

  it("commits a typed draft on close, and another on dispose", () => {
    const { page, sttKeySettings, keyInput } = build();

    fireEvent.input(keyInput, { target: { value: "sk-close" } });
    act(() => page.close());
    expect(sttKeySettings.get().apiKey).toBe("sk-close");

    fireEvent.input(keyInput, { target: { value: "sk-dispose" } });
    close(page);
    expect(sttKeySettings.get().apiKey).toBe("sk-dispose");
  });

  it("shows the revealed key and keeps it showing across an unrelated re-render", () => {
    const { page, vad, keyInput } = build();
    const toggle = page.el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
    const bargeIn = page.el.querySelector<HTMLButtonElement>(".yui-bargein-switch")!;

    act(() => toggle.click());
    expect(keyInput.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    act(() => bargeIn.click());
    expect(vad.get().bargeIn).toBe(false);
    expect(keyInput.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("createQuickControls — reading dictionary placement", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders as the last section of the Listening page", () => {
    const qc = createQuickControls(defaultQcArgs(mount));
    const input = qc.el.querySelector("#yui-panel-listening")!;
    expect(input.querySelector(".yui-reading")).toBe(input.querySelector(".yui-sec:last-child"));
    act(() => qc.dispose());
  });
});

describe("createQuickControls — silence slider", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes a pointer press on its track in the panel", () => {
    const mount = document.body.appendChild(document.createElement("div"));
    const vad = createVadSettings({ storage: { load: () => null, save: () => {} } });
    const qc = createQuickControls({ ...defaultQcArgs(mount), vad });
    const slider = qc.el.querySelector<HTMLInputElement>(".yui-vad__slider input")!;

    pressSlider(slider, 0.6).release();

    expect(vad.get().silenceMs).toBe(2000);
    act(() => qc.dispose());
  });
});
