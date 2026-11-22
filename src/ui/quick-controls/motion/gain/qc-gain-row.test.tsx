// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../../io/assets/vrm-selection";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../../../io/voice/voices/voice-import-flow";
import { createLipsyncSettings } from "../../../../settings/avatar/lipsync-settings";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import { createVadSettings, VAD_SILENCE_DEFAULT } from "../../../../settings/voice/vad-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
  pressSlider,
} from "../../test-helpers";
import { PREVIEW_PEAK_RMS } from "./gain-preview";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("createQuickControls — gain row", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let proactiveSettings: ReturnType<typeof createProactiveSettings>;
  let scheduleSettings: ReturnType<typeof createScheduleSettings>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let importVrm: Mock<() => Promise<void>>;
  let removeUserVrm: Mock<(id: string) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let pickVoiceImport: Mock<() => Promise<PickedVoiceImport | null>>;
  let commitVoiceImport: Mock<(stagedId: string, name: string) => Promise<void>>;
  let removeVoice: Mock<(id: string) => Promise<void>>;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);

    onGainPreview = vi.fn<(mouthOpen: number) => void>();
    onGainPreviewEnd = vi.fn<() => void>();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    endpointsSettings = createEndpointsSettings();
    proactiveSettings = createProactiveSettings();
    scheduleSettings = createScheduleSettings();
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
    pickVoiceImport = vi.fn<() => Promise<PickedVoiceImport | null>>(async () => null);
    commitVoiceImport = vi.fn<(stagedId: string, name: string) => Promise<void>>(async () => {});
    removeVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  const built: ReturnType<typeof createQuickControls>[] = [];

  afterEach(() => {
    act(() => {
      for (const qc of built.splice(0)) qc.dispose();
    });
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const qc = createQuickControls({
      ...defaultQcArgs(mount),
      lipsync,
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      scheduleSettings,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      pickVoiceImport,
      commitVoiceImport,
      removeVoice,
      ...extra,
    });
    built.push(qc);
    return qc;
  }

  const gainSlider = (qc: ReturnType<typeof buildQc>) =>
    qc.el.querySelector<HTMLInputElement>(".yui-lipsync-gain__slider input")!;

  // ── Slider exists with correct attributes ─────────────────────────────────

  it("renders a range slider with min=0.5, max=6, value=2 (default gain)", () => {
    const qc = buildQc();
    qc.open();

    const slider = gainSlider(qc);
    expect(slider).not.toBeNull();
    expect(slider.min).toBe("0.5");
    expect(slider.max).toBe("6");
    expect(slider.value).toBe("2");
  });

  it("renders a readout .yui-gain__value showing '2.0×' initially", () => {
    const qc = buildQc();
    qc.open();

    const readout = qc.el.querySelector(".yui-lipsync-gain__value");
    expect(readout).not.toBeNull();
    expect(readout!.textContent).toBe("2.0×");
  });

  // ── A change: setGain + preview + readout update ──────────────────────

  it("a change sets lipsync gain, calls onGainPreview, and updates readout", () => {
    const qc = buildQc();
    qc.open();

    fireEvent.change(gainSlider(qc), { target: { value: "3" } });

    expect(lipsync.get().gain).toBe(3);

    // preview formula: clamp(3 * PREVIEW_PEAK_RMS, 0, 1)
    expect(onGainPreview).toHaveBeenCalledOnce();
    expect(onGainPreview.mock.calls[0][0]).toBeCloseTo(3 * PREVIEW_PEAK_RMS);

    const readout = qc.el.querySelector(".yui-lipsync-gain__value");
    expect(readout!.textContent).toBe("3.0×");
  });

  // ── A release ends the preview ────────────────────────────────────────────────

  it("a release after a drag calls onGainPreviewEnd exactly once", () => {
    const qc = buildQc();
    qc.open();

    const drag = pressSlider(gainSlider(qc), 0.5);
    drag.moveTo(0.6);
    expect(onGainPreviewEnd).not.toHaveBeenCalled();
    drag.release();

    expect(onGainPreviewEnd).toHaveBeenCalledOnce();
  });

  // ── Escape, the window's close, ends preview if active ─────────────────────

  it("Escape while preview active calls onGainPreviewEnd", () => {
    const qc = buildQc({ onCloseWindow: vi.fn() });
    qc.open();

    // A keyboard step commits at once and leaves the preview running.
    fireEvent.keyDown(gainSlider(qc), { key: "ArrowLeft" });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onGainPreviewEnd).toHaveBeenCalledOnce();
  });

  it("Escape without prior input does NOT call onGainPreviewEnd", () => {
    const qc = buildQc({ onCloseWindow: vi.fn() });
    qc.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onGainPreviewEnd).not.toHaveBeenCalled();
  });

  // ── External store update reflects in slider + readout ───────────────────

  it("external lipsync.setGain updates slider value and readout while open", () => {
    const qc = buildQc();
    qc.open();

    act(() => lipsync.setGain(1.5));

    expect(gainSlider(qc).value).toBe("1.5");

    const readout = qc.el.querySelector(".yui-lipsync-gain__value");
    expect(readout!.textContent).toBe("1.5×");
  });

  // ── Gain and VAD sliders stay independent ────────────────────────────────
  // Both rows are built on one shared Slider, so each side effect must reach
  // only its own store: the lipsync preview is the gain slider's alone.

  function sliders(qc: ReturnType<typeof buildQc>) {
    return {
      gain: gainSlider(qc),
      vad: qc.el.querySelector<HTMLInputElement>(".yui-vad__slider input")!,
    };
  }

  it("VAD slider input commits silenceMs without starting the lipsync preview", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { vad: vadSlider } = sliders(qc);
    fireEvent.change(vadSlider, { target: { value: "2000" } });

    expect(vad.get().silenceMs).toBe(2000);
    expect(onGainPreview).not.toHaveBeenCalled();
    expect(lipsync.get().gain).toBe(2);
    expect(onGainPreviewEnd).not.toHaveBeenCalled();
  });

  it("gain slider input leaves silenceMs untouched", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { gain: gainInput } = sliders(qc);
    fireEvent.change(gainInput, { target: { value: "3" } });

    expect(lipsync.get().gain).toBe(3);
    expect(vad.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
  });

  it("dispose() detaches both sliders, not just one", () => {
    const vad = createVadSettings();
    const qc = buildQc({ vad });
    qc.open();

    const { gain: gainInput, vad: vadSlider } = sliders(qc);
    built.splice(built.indexOf(qc), 1);
    act(() => qc.dispose());

    fireEvent.change(gainInput, { target: { value: "4" } });
    fireEvent.change(vadSlider, { target: { value: "2500" } });

    expect(lipsync.get().gain).toBe(2);
    expect(vad.get().silenceMs).toBe(VAD_SILENCE_DEFAULT);
    expect(onGainPreview).not.toHaveBeenCalled();
  });
});
