// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import { createAgentNotifySettings } from "../../io/agent-notify-settings";
import { createAgentSettings } from "../../io/agent-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createFlagSettings } from "../../io/persisted-store";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import { createVadSettings, VAD_SILENCE_DEFAULT } from "../../io/vad-settings";
import type { createVrmSelection } from "../../io/vrm-selection";
import { setLocale } from "../i18n";
import { createQuickControls, PREVIEW_PEAK_RMS } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "./test-helpers";

describe("createQuickControls — toggles + gain row", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let proactiveSettings: ReturnType<typeof createProactiveSettings>;
  let scheduleSettings: ReturnType<typeof createScheduleSettings>;
  let onPopOut: Mock<() => void>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let importVrm: Mock<() => Promise<void>>;
  let removeUserVrm: Mock<(id: string) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let pickVoiceImport: Mock<() => Promise<{ srcPath: string; seedName: string } | null>>;
  let commitVoiceImport: Mock<(srcPath: string, name: string) => Promise<void>>;
  let removeUserVoice: Mock<(id: string) => Promise<void>>;

  beforeEach(() => {
    // Make rAF synchronous so open() → is-open transition happens immediately in tests
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    mount = document.createElement("div");
    document.body.appendChild(mount);

    onGainPreview = vi.fn<(mouthOpen: number) => void>();
    onGainPreviewEnd = vi.fn<() => void>();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    endpointsSettings = createEndpointsSettings();
    proactiveSettings = createProactiveSettings();
    scheduleSettings = createScheduleSettings();
    onPopOut = vi.fn<() => void>();
    vrmSelection = makeVrmSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async (option) => {
      vrmSelection.select(option.id);
    });
    importVrm = vi.fn<() => Promise<void>>(async () => {});
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {});
    speakerSelection = makeSpeakerSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    // refresh is server-side only — default fake resolves without touching the store.
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {});
    pickVoiceImport = vi.fn<() => Promise<{ srcPath: string; seedName: string } | null>>(
      async () => null,
    );
    commitVoiceImport = vi.fn<(srcPath: string, name: string) => Promise<void>>(async () => {});
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
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
      lipsync,
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      scheduleSettings,
      onPopOut,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      pickVoiceImport,
      commitVoiceImport,
      removeUserVoice,
      ...extra,
    });
  }

  it("mounts both cue-list sections in the proactive tab", () => {
    const qc = buildQc();
    qc.open();

    // Both section titles are present in the proactive panel
    const titles = Array.from(
      qc.el.querySelectorAll<HTMLElement>("#yui-panel-react [data-testid='cue-list-title']"),
    ).map((el) => el.textContent?.trim() ?? "");
    expect(titles).toContain("시간대 인사");
    expect(titles).toContain("루프 반응");

    // Cue rows from default store data are rendered
    const cueRows = qc.el.querySelectorAll("#yui-panel-react [data-testid='cue-row']");
    expect(cueRows.length).toBeGreaterThan(0);

    qc.dispose();
  });

  it("schedule cue-list master switch reflects scheduleSettings enabled state", () => {
    const qc = buildQc();
    qc.open();

    // The second master switch belongs to the schedule section (time-of-day greeting)
    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    expect(masterSwitches.length).toBe(2);

    // Default: scheduleSettings enabled = true
    expect(masterSwitches[1].getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("proactive cue-list master switch reflects proactiveSettings enabled state", () => {
    const qc = buildQc();
    qc.open();

    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    // First master switch = proactive section
    expect(masterSwitches[0].getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("clicking schedule master switch calls scheduleSettings.setEnabled", () => {
    const localSchedule = createScheduleSettings();
    const qc = buildQc({ scheduleSettings: localSchedule });
    qc.open();

    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    expect(localSchedule.get().enabled).toBe(true);
    masterSwitches[1].click();
    expect(localSchedule.get().enabled).toBe(false);

    qc.dispose();
  });

  it("clicking proactive master switch calls proactiveSettings.setEnabled", () => {
    const localProactive = createProactiveSettings();
    const qc = buildQc({ proactiveSettings: localProactive });
    qc.open();

    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    expect(localProactive.get().enabled).toBe(true);
    masterSwitches[0].click();
    expect(localProactive.get().enabled).toBe(false);

    qc.dispose();
  });

  it("dispose() destroys cue-list sections without errors", () => {
    const qc = buildQc();
    qc.open();

    expect(() => qc.dispose()).not.toThrow();
  });

  // ── Idle power-saving toggle row (Advanced tab) ──────────────────────────

  it("renders the idle-throttle toggle row in the Advanced tab, ON by default", () => {
    const qc = buildQc();
    qc.open();

    const idleSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch");
    expect(idleSwitch).not.toBeNull();
    expect(idleSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(idleSwitch!.getAttribute("role")).toBe("switch");
    expect(idleSwitch!.getAttribute("aria-label")).toBe("유휴 시 절전");

    const row = idleSwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("유휴 시 절전");
    expect(row.querySelector(".yui-row__sub")!.textContent).toContain(
      "캐릭터가 가만히 있을 때 프레임을 낮춰 전력을 아낍니다",
    );

    qc.dispose();
  });

  it("clicking the idle-throttle switch toggles idleThrottleSettings.setEnabled", () => {
    const idleThrottleSettings = createFlagSettings(true);
    const qc = buildQc({ idleThrottleSettings });
    qc.open();

    const idleSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
    expect(idleThrottleSettings.get().enabled).toBe(true);

    idleSwitch.click();
    expect(idleThrottleSettings.get().enabled).toBe(false);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("false");

    idleSwitch.click();
    expect(idleThrottleSettings.get().enabled).toBe(true);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("external idleThrottleSettings.setEnabled reflects on the switch while open", () => {
    const idleThrottleSettings = createFlagSettings(true);
    const qc = buildQc({ idleThrottleSettings });
    qc.open();

    const idleSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
    idleThrottleSettings.setEnabled(false);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("false");

    idleThrottleSettings.setEnabled(true);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── Cursor gaze alignment toggle row (Advanced tab) ────────────────────────

  it("renders the gaze toggle row only when gazeSettings is provided, ON by default", () => {
    const withoutGaze = buildQc();
    withoutGaze.open();
    expect(withoutGaze.el.querySelector(".yui-gaze-switch")).toBeNull();
    withoutGaze.dispose();

    const qc = buildQc({ gazeSettings: createFlagSettings(true) });
    qc.open();
    const gazeSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-gaze-switch");
    expect(gazeSwitch).not.toBeNull();
    expect(gazeSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(gazeSwitch!.getAttribute("role")).toBe("switch");
    expect(gazeSwitch!.getAttribute("aria-label")).toBe("커서 따라보기");

    const row = gazeSwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("커서 따라보기");
    qc.dispose();
  });

  it("clicking the gaze switch toggles gazeSettings.setEnabled", () => {
    const gazeSettings = createFlagSettings(true);
    const qc = buildQc({ gazeSettings });
    qc.open();

    const gazeSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-gaze-switch")!;
    expect(gazeSettings.get().enabled).toBe(true);

    gazeSwitch.click();
    expect(gazeSettings.get().enabled).toBe(false);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("false");

    gazeSwitch.click();
    expect(gazeSettings.get().enabled).toBe(true);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("external gazeSettings.setEnabled reflects on the switch while open", () => {
    const gazeSettings = createFlagSettings(true);
    const qc = buildQc({ gazeSettings });
    qc.open();

    const gazeSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-gaze-switch")!;
    gazeSettings.setEnabled(false);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("false");

    gazeSettings.setEnabled(true);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── Agent notifications toggle row (Advanced tab) ─────────────────────────

  it("renders the agentNotify toggle row only when agentNotifySettings is provided, OFF by default", () => {
    const withoutStore = buildQc();
    withoutStore.open();
    expect(withoutStore.el.querySelector(".yui-agentnotify-switch")).toBeNull();
    withoutStore.dispose();

    const qc = buildQc({ agentNotifySettings: createAgentNotifySettings() });
    qc.open();
    const agentNotifySwitch = qc.el.querySelector<HTMLButtonElement>(".yui-agentnotify-switch");
    expect(agentNotifySwitch).not.toBeNull();
    expect(agentNotifySwitch!.getAttribute("aria-checked")).toBe("false");
    expect(agentNotifySwitch!.getAttribute("role")).toBe("switch");
    expect(agentNotifySwitch!.getAttribute("aria-label")).toBe("에이전트 알림");

    const row = agentNotifySwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("에이전트 알림");
    qc.dispose();
  });

  it("clicking the agentNotify switch toggles agentNotifySettings.setEnabled", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();

    const agentNotifySwitch = qc.el.querySelector<HTMLButtonElement>(".yui-agentnotify-switch")!;
    expect(agentNotifySettings.get().enabled).toBe(false);

    agentNotifySwitch.click();
    expect(agentNotifySettings.get().enabled).toBe(true);
    expect(agentNotifySwitch.getAttribute("aria-checked")).toBe("true");

    agentNotifySwitch.click();
    expect(agentNotifySettings.get().enabled).toBe(false);
    expect(agentNotifySwitch.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("external agentNotifySettings.setEnabled reflects on the switch while open", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();

    const agentNotifySwitch = qc.el.querySelector<HTMLButtonElement>(".yui-agentnotify-switch")!;
    agentNotifySettings.setEnabled(true);
    expect(agentNotifySwitch.getAttribute("aria-checked")).toBe("true");

    agentNotifySettings.setEnabled(false);
    expect(agentNotifySwitch.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  // ── TTS voice output toggle ──────────────────────────────────────────────────

  it("clicking the TTS switch toggles ttsSettings.setEnabled", () => {
    const ttsSettings = createFlagSettings(true);
    const qc = buildQc({ ttsSettings });
    qc.open();

    const ttsSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-tts-switch")!;
    expect(ttsSettings.get().enabled).toBe(true);

    ttsSwitch.click();
    expect(ttsSettings.get().enabled).toBe(false);
    expect(ttsSwitch.getAttribute("aria-checked")).toBe("false");

    ttsSwitch.click();
    expect(ttsSettings.get().enabled).toBe(true);
    expect(ttsSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("external ttsSettings.setEnabled reflects on the switch while open", () => {
    const ttsSettings = createFlagSettings(true);
    const qc = buildQc({ ttsSettings });
    qc.open();

    const ttsSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-tts-switch")!;
    ttsSettings.setEnabled(false);
    expect(ttsSwitch.getAttribute("aria-checked")).toBe("false");

    ttsSettings.setEnabled(true);
    expect(ttsSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("renders the TTS switch with default aria-checked and clicking is a no-op when ttsSettings is absent", () => {
    const qc = buildQc();
    qc.open();

    const ttsSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-tts-switch");
    expect(ttsSwitch).not.toBeNull();
    expect(ttsSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(ttsSwitch!.getAttribute("role")).toBe("switch");

    // No ttsSettings injected — clicking must not throw and aria-checked stays put.
    expect(() => ttsSwitch!.click()).not.toThrow();
    expect(ttsSwitch!.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── Barge-in toggle ─────────────────────────────────────────────────────────

  it("clicking the barge-in switch toggles vad.setBargeIn", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const bargeInSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-bargein-switch")!;
    expect(vad.get().bargeIn).toBe(true);

    bargeInSwitch.click();
    expect(vad.get().bargeIn).toBe(false);
    expect(bargeInSwitch.getAttribute("aria-checked")).toBe("false");

    bargeInSwitch.click();
    expect(vad.get().bargeIn).toBe(true);
    expect(bargeInSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("external vad.setBargeIn reflects on the switch while open", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const bargeInSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-bargein-switch")!;
    vad.setBargeIn(false);
    expect(bargeInSwitch.getAttribute("aria-checked")).toBe("false");

    vad.setBargeIn(true);
    expect(bargeInSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("renders the barge-in switch with default aria-checked reflecting vadSettings.bargeIn", () => {
    const qc = buildQc();
    qc.open();

    const bargeInSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-bargein-switch");
    expect(bargeInSwitch).not.toBeNull();
    expect(bargeInSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(bargeInSwitch!.getAttribute("role")).toBe("switch");

    qc.dispose();
  });

  // ── Slider exists with correct attributes ─────────────────────────────────

  it("renders a range slider with min=0.5, max=6, value=2 (default gain)", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      "input.yui-gain__slider:not(.yui-vad__slider)[type=range]",
    );
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("0.5");
    expect(slider!.max).toBe("6");
    expect(slider!.value).toBe("2");

    qc.dispose();
  });

  it("renders a readout .yui-gain__value showing '2.0×' initially", () => {
    const qc = buildQc();
    qc.open();

    const readout = qc.el.querySelector(".yui-gain__value");
    expect(readout).not.toBeNull();
    expect(readout!.textContent).toBe("2.0×");

    qc.dispose();
  });

  // ── Input event: setGain + preview + readout update ──────────────────────

  it("input event sets lipsync gain, calls onGainPreview, and updates readout", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider[type=range]")!;
    slider.value = "3";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(lipsync.get().gain).toBe(3);

    // preview formula: clamp(3 * PREVIEW_PEAK_RMS, 0, 1)
    expect(onGainPreview).toHaveBeenCalledOnce();
    expect(onGainPreview.mock.calls[0][0]).toBeCloseTo(3 * PREVIEW_PEAK_RMS);

    const readout = qc.el.querySelector(".yui-gain__value");
    expect(readout!.textContent).toBe("3.0×");

    qc.dispose();
  });

  // ── pointerup ends preview ────────────────────────────────────────────────

  it("pointerup after an input event calls onGainPreviewEnd exactly once", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider[type=range]")!;
    slider.value = "3";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("pointerup", { bubbles: true }));

    expect(onGainPreviewEnd).toHaveBeenCalledOnce();

    qc.dispose();
  });

  // ── close() ends preview if active ───────────────────────────────────────

  it("close() while preview active calls onGainPreviewEnd", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider[type=range]")!;
    slider.value = "1.5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    qc.close();

    expect(onGainPreviewEnd).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("close() without prior input does NOT call onGainPreviewEnd", () => {
    const qc = buildQc();
    qc.open();
    qc.close();

    expect(onGainPreviewEnd).not.toHaveBeenCalled();

    qc.dispose();
  });

  // ── External store update reflects in slider + readout ───────────────────

  it("external lipsync.setGain updates slider value and readout while open", () => {
    const qc = buildQc();
    qc.open();

    lipsync.setGain(1.5);

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider[type=range]")!;
    expect(slider.value).toBe("1.5");

    const readout = qc.el.querySelector(".yui-gain__value");
    expect(readout!.textContent).toBe("1.5×");

    qc.dispose();
  });

  // ── Gain and VAD sliders stay independent ────────────────────────────────
  // Both rows are driven by one shared slider binder, so each side effect must reach
  // only its own store: the lipsync preview is the gain slider's alone.

  function sliders(qc: ReturnType<typeof buildQc>) {
    return {
      gain: qc.el.querySelector<HTMLInputElement>(
        "input.yui-gain__slider:not(.yui-vad__slider)[type=range]",
      )!,
      vad: qc.el.querySelector<HTMLInputElement>("input.yui-vad__slider[type=range]")!,
    };
  }

  it("VAD slider input commits silenceMs without starting the lipsync preview", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { vad: vadSlider } = sliders(qc);
    vadSlider.value = "2000";
    vadSlider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(vad.get().silenceMs).toBe(2000);
    expect(onGainPreview).not.toHaveBeenCalled();
    expect(lipsync.get().gain).toBe(2);

    vadSlider.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onGainPreviewEnd).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("gain slider input leaves silenceMs untouched", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { gain: gainSlider } = sliders(qc);
    gainSlider.value = "3";
    gainSlider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(lipsync.get().gain).toBe(3);
    expect(vad.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);

    qc.dispose();
  });

  it("dispose() detaches both sliders, not just one", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { gain: gainSlider, vad: vadSlider } = sliders(qc);
    qc.dispose();

    gainSlider.value = "4";
    gainSlider.dispatchEvent(new Event("input", { bubbles: true }));
    vadSlider.value = "2500";
    vadSlider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(lipsync.get().gain).toBe(2);
    expect(vad.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
    expect(onGainPreview).not.toHaveBeenCalled();
  });
});
