// @vitest-environment jsdom
/**
 * quick-controls.test.ts — the lipsync gain row in the quick-settings popover.
 *
 * Pins THREE new options added to createQuickControls:
 *   lipsync        — a createLipsyncSettings store instance
 *   onGainPreview  — (mouthOpen: number) => void  live VRM mouth preview (0..1)
 *   onGainPreviewEnd — () => void                 stop the preview
 *
 * Preview formula: clamp(gain * PREVIEW_PEAK_RMS, 0, 1)
 *   PREVIEW_PEAK_RMS = 0.15  (spoken peak RMS)
 * Implementer must use the same constant and the selectors:
 *   .yui-gain__slider  (input[type=range])
 *   .yui-gain__value   (readout span)
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../config/load";
import { createAgentNotifySettings } from "../io/agent-notify-settings";
import {
  type AgentSettings,
  type AgentStorage,
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
} from "../io/agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "../io/api-key-settings";
import { createChatKeySettings } from "../io/chat-key-settings";
import { createEndpointsSettings } from "../io/endpoints-settings";
import { createFillerSettings } from "../io/filler-settings";
import { createGazeSettings } from "../io/gaze-settings";
import { createGithubSettings } from "../io/github-settings";
import { createIdleThrottleSettings } from "../io/idle-throttle-settings";
import { createLipsyncSettings } from "../io/lipsync-settings";
import { createPresenceSettings } from "../io/presence-settings";
import { createProactiveSettings } from "../io/proactive-settings";
import { createScheduleSettings } from "../io/schedule-settings";
import { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import { createSessionStore } from "../io/session-store";
import { createSpeakerSelection, type SpeakerOption } from "../io/speaker-selection";
import { createTtsSettings } from "../io/tts-settings";
import { createVadSettings, VAD_SILENCE_DEFAULT } from "../io/vad-settings";
import { createVrmSelection } from "../io/vrm-selection";
import { getLocale, subscribe as i18nSubscribe, LOCALE_DISPLAY_NAMES, setLocale } from "./i18n";
import { createQuickControls, PREVIEW_PEAK_RMS } from "./quick-controls";

// jsdom 29 lacks CSS.escape (browsers have it) — polyfill so selector-escaping paths run.
// Escapes ASCII chars that aren't safe identifier chars; non-ASCII passes through (safe unescaped).
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the polyfill must match the C0 control range to escape it.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

// In-memory AgentStorage so each test starts from a clean store.
function inMemoryAgentStorage(): AgentStorage {
  let value: AgentSettings | null = null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

// In-memory ApiKeyStorage so stt/tts key stores don't share localStorage in tests.
function inMemoryApiKeyStorage(): import("../io/api-key-settings").ApiKeyStorage {
  let value: { apiKey: string } | null = null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal stubs for existing required options
// ─────────────────────────────────────────────────────────────────────────────

function makeSettings() {
  return {
    get: () => ({ enabled: false, source: { kind: "monitor" as const, index: 0 } }),
    setEnabled: vi.fn(),
    setSource: vi.fn(),
    reloadFromStorage: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

function makeSourceProvider() {
  return {
    listMonitors: async () => [],
  };
}

function makeVoiceStatus() {
  return {
    get: () => ({
      state: "idle" as const,
      label: "Idle",
      detail: "Voice input is off",
      visible: false,
    }),
    set: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Build a real createVrmSelection over an explicit manifest (default Carlotta).
function makeVrmSelection(ids: string[] = ["carlotta", "aria", "mirai"]) {
  const available: AvatarOption[] = ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    url: `/vrms/${id}.vrm`,
    source: "bundled",
  }));
  return createVrmSelection({ available, defaultUrl: available[0].url });
}

// A user (imported) option mirroring vrm-import's output shape.
const USER_OPTION: AvatarOption = {
  id: "cat",
  label: "깜냥이",
  url: "asset://localhost/app-data/vrms/cat.vrm",
  source: "user",
};

// Build a real createSpeakerSelection over an explicit manifest (default first id).
function makeSpeakerSelection(ids: string[] = ["natsume", "ayase", "rena"]) {
  const available: SpeakerOption[] = ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    ref_url: `/references/${id}.wav`,
  }));
  return createSpeakerSelection({ available, defaultId: available[0].id });
}

// A user (imported) voice mirroring voice-import's output shape.
const USER_VOICE: SpeakerOption = {
  id: "myvoice",
  label: "내 목소리",
  ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
  source: "user",
};

describe("createQuickControls — gain row", () => {
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
  let importVoice: Mock<() => Promise<void>>;
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
    importVoice = vi.fn<() => Promise<void>>(async () => {});
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* localStorage 미사용 환경 무시 */
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
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync,
      vad: createVadSettings(),
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      scheduleSettings,
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      importVoice,
      removeUserVoice,
      ...extra,
    });
  }

  // ── 시간대 인사 · 주도적 반응 cue-list sections ──────────────────────────

  it("mounts both cue-list sections (schedule in input, loop in react tab)", () => {
    const qc = buildQc();
    qc.open();

    // Both section titles are present across the panels
    const titles = Array.from(
      qc.el.querySelectorAll<HTMLElement>("[data-testid='cue-list-title']"),
    ).map((el) => el.textContent?.trim() ?? "");
    expect(titles).toContain("시간대 인사");
    expect(titles).toContain("루프 반응");

    // Cue rows from default store data are rendered
    const scheduleRows = qc.el.querySelectorAll("#yui-panel-input [data-testid='cue-row']");
    expect(scheduleRows.length).toBeGreaterThan(0);

    qc.dispose();
  });

  it("schedule cue-list master switch reflects scheduleSettings enabled state", () => {
    const qc = buildQc();
    qc.open();

    // The first master switch belongs to the schedule section (시간대 인사)
    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    expect(masterSwitches.length).toBe(2);

    // Default: scheduleSettings enabled = true
    expect(masterSwitches[0].getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("proactive cue-list master switch reflects proactiveSettings enabled state", () => {
    const qc = buildQc();
    qc.open();

    const masterSwitches = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>("[data-testid='cue-list-master-switch']"),
    );
    // Second master switch = proactive section
    expect(masterSwitches[1].getAttribute("aria-checked")).toBe("true");

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
    masterSwitches[0].click();
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
    masterSwitches[1].click();
    expect(localProactive.get().enabled).toBe(false);

    qc.dispose();
  });

  it("cue-list sections are placed before the screenshot row", () => {
    const qc = buildQc();
    qc.open();

    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    const cueSections = inputPanel.querySelector(".yui-cue-sections")!;
    const screenshotSwitch = inputPanel.querySelector<HTMLButtonElement>(
      ".yui-switch[aria-label='스크린샷 첨부']",
    )!;

    // cueSections must appear in DOM before screenshotSwitch
    const children = Array.from(inputPanel.querySelectorAll("*"));
    expect(children.indexOf(cueSections)).toBeLessThan(children.indexOf(screenshotSwitch));

    qc.dispose();
  });

  it("dispose() destroys cue-list sections without errors", () => {
    const qc = buildQc();
    qc.open();

    expect(() => qc.dispose()).not.toThrow();
  });

  // ── 유휴 절전 toggle row (Advanced tab) ──────────────────────────────────

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
    const idleThrottleSettings = createIdleThrottleSettings();
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
    const idleThrottleSettings = createIdleThrottleSettings();
    const qc = buildQc({ idleThrottleSettings });
    qc.open();

    const idleSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
    idleThrottleSettings.setEnabled(false);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("false");

    idleThrottleSettings.setEnabled(true);
    expect(idleSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── 카메라 시선 맞춤(gaze) toggle row (Advanced tab) ──────────────────────────

  it("renders the gaze toggle row only when gazeSettings is provided, ON by default", () => {
    const withoutGaze = buildQc();
    withoutGaze.open();
    expect(withoutGaze.el.querySelector(".yui-gaze-switch")).toBeNull();
    withoutGaze.dispose();

    const qc = buildQc({ gazeSettings: createGazeSettings() });
    qc.open();
    const gazeSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-gaze-switch");
    expect(gazeSwitch).not.toBeNull();
    expect(gazeSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(gazeSwitch!.getAttribute("role")).toBe("switch");
    expect(gazeSwitch!.getAttribute("aria-label")).toBe("카메라 시선 맞춤");

    const row = gazeSwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("카메라 시선 맞춤");
    qc.dispose();
  });

  it("clicking the gaze switch toggles gazeSettings.setEnabled", () => {
    const gazeSettings = createGazeSettings();
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
    const gazeSettings = createGazeSettings();
    const qc = buildQc({ gazeSettings });
    qc.open();

    const gazeSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-gaze-switch")!;
    gazeSettings.setEnabled(false);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("false");

    gazeSettings.setEnabled(true);
    expect(gazeSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── GitHub PR 워처 toggle row (Advanced tab) ─────────────────────────────────

  it("renders the github toggle row only when githubSettings is provided, OFF by default", () => {
    const withoutGithub = buildQc();
    withoutGithub.open();
    expect(withoutGithub.el.querySelector(".yui-github-switch")).toBeNull();
    withoutGithub.dispose();

    const qc = buildQc({ githubSettings: createGithubSettings() });
    qc.open();
    const githubSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-github-switch");
    expect(githubSwitch).not.toBeNull();
    expect(githubSwitch!.getAttribute("aria-checked")).toBe("false");
    expect(githubSwitch!.getAttribute("role")).toBe("switch");
    expect(githubSwitch!.getAttribute("aria-label")).toBe("GitHub PR 지켜보기");

    const row = githubSwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("GitHub PR 지켜보기");
    qc.dispose();
  });

  it("clicking the github switch toggles githubSettings.setEnabled", () => {
    const githubSettings = createGithubSettings();
    const qc = buildQc({ githubSettings });
    qc.open();

    const githubSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-github-switch")!;
    expect(githubSettings.get().enabled).toBe(false);

    githubSwitch.click();
    expect(githubSettings.get().enabled).toBe(true);
    expect(githubSwitch.getAttribute("aria-checked")).toBe("true");

    githubSwitch.click();
    expect(githubSettings.get().enabled).toBe(false);
    expect(githubSwitch.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("external githubSettings.setEnabled reflects on the switch while open", () => {
    const githubSettings = createGithubSettings();
    const qc = buildQc({ githubSettings });
    qc.open();

    const githubSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-github-switch")!;
    githubSettings.setEnabled(true);
    expect(githubSwitch.getAttribute("aria-checked")).toBe("true");

    githubSettings.setEnabled(false);
    expect(githubSwitch.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  // ── Agent completion notifications toggle row (Advanced tab) ─────────────

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
    expect(agentNotifySwitch!.getAttribute("aria-label")).toBe("에이전트 완료 알림");

    const row = agentNotifySwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("에이전트 완료 알림");
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

  // ── TTS 음성 출력 토글 ─────────────────────────────────────────────────────

  it("clicking the TTS switch toggles ttsSettings.setEnabled", () => {
    const ttsSettings = createTtsSettings();
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
    const ttsSettings = createTtsSettings();
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

  // ── 대화 (Agent) section: reasoning effort segmented control ───────────────

  it("clicking the Medium segment sets reasoning_effort and marks it selected", () => {
    const qc = buildQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // order: none · minimal · low · medium
    expect(btns).toHaveLength(4);
    const medium = btns[3];

    medium.click();

    expect(agentSettings.get().reasoning_effort).toBe("medium");
    expect(medium.getAttribute("aria-checked")).toBe("true");
    for (const b of btns) {
      if (b !== medium) expect(b.getAttribute("aria-checked")).toBe("false");
    }

    qc.dispose();
  });

  it("ArrowRight on the segmented control moves selection (roving) and updates the store", () => {
    const qc = buildQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // start at none (index 0)
    expect(btns[0].getAttribute("aria-checked")).toBe("true");

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(agentSettings.get().reasoning_effort).toBe("minimal");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  // ── 대화 (Agent) section: instructions textarea ───────────────────────────

  it("typing into the instructions textarea calls setInstructions", () => {
    const qc = buildQc();
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    ta.value = "be terse";
    ta.dispatchEvent(new Event("input", { bubbles: true }));

    expect(agentSettings.get().instructions).toBe("be terse");

    qc.dispose();
  });

  it("기본값으로 되돌리기 sets instructions to '' and clears the textarea", () => {
    agentSettings.setInstructions("custom note");
    const qc = buildQc();
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.value).toBe("custom note");

    const reset = qc.el.querySelector<HTMLButtonElement>(".yui-reset")!;
    reset.click();

    expect(agentSettings.get().instructions).toBe("");
    expect(ta.value).toBe("");

    qc.dispose();
  });

  it("caps the instructions textarea at INSTRUCTIONS_MAX_LEN", () => {
    const qc = buildQc();
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.maxLength).toBe(INSTRUCTIONS_MAX_LEN);

    qc.dispose();
  });

  // ── viewpoint reset (camera orbit) ─────────────────────────────────────────

  it("renders the viewpoint reset button only when onResetViewpoint is provided", () => {
    const without = buildQc();
    without.open();
    expect(without.el.querySelector(".yui-viewpoint-reset")).toBeNull();
    without.dispose();

    const withReset = buildQc({ onResetViewpoint: vi.fn() });
    withReset.open();
    expect(withReset.el.querySelector(".yui-viewpoint-reset")).not.toBeNull();
    withReset.dispose();
  });

  it("clicking the viewpoint reset button invokes onResetViewpoint", () => {
    const onResetViewpoint = vi.fn();
    const qc = buildQc({ onResetViewpoint });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset")!.click();
    expect(onResetViewpoint).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("uses getDefaultInstructions() as the textarea placeholder when provided", () => {
    const qc = buildQc({ getDefaultInstructions: () => "default nudge here" });
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.placeholder).toBe("default nudge here");

    qc.dispose();
  });

  // ── 엔드포인트 섹션 ───────────────────────────────────────────────────────

  it("renders four collapsible per-service sections (chat/stt/tts/broker), each with a yui-select", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sections = Array.from(
      qc.el.querySelectorAll<HTMLDetailsElement>("#yui-panel-adv details.yui-svc"),
    );
    expect(sections.map((s) => s.dataset.svc)).toEqual(["chat", "stt", "tts", "broker"]);
    // collapsible (default collapsed) + each leads with a type dropdown.
    for (const s of sections) {
      expect(s.open).toBe(false);
      expect(s.querySelector(".yui-select")).not.toBeNull();
    }
    // single-option sections are inert (--single); STT is the only one left. Chat and TTS
    // are interactive dropdowns (chat_api / tts_provider).
    expect(sections[0].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      false,
    );
    expect(sections[1].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      true,
    );
    expect(sections[2].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      false,
    );

    // each section carries its own URL field(s) inside it.
    const fieldIn = (svc: string, key: string): boolean =>
      !!qc.el.querySelector(`details[data-svc="${svc}"] .yui-input-row[data-ep-field="${key}"]`);
    expect(fieldIn("chat", "chat_base_url")).toBe(true);
    expect(fieldIn("chat", "chat_model")).toBe(true);
    expect(fieldIn("stt", "stt_base_url")).toBe(true);
    expect(fieldIn("tts", "irodori_base_url")).toBe(true);
    expect(fieldIn("tts", "tts_base_url")).toBe(true);
    expect(fieldIn("tts", "tts_voice")).toBe(true);
    expect(fieldIn("broker", "broker_base_url")).toBe(true);

    qc.dispose();
  });

  it("populates endpoint placeholders from getEndpointDefaults() on open even when defaults arrive after construction", () => {
    // 패널은 config 로드 전에 생성된다 — 생성 시점엔 defaults가 없고 open() 시점에 채워져야 한다.
    let defaults: Record<string, string> | undefined;
    const qc = buildQc({ getEndpointDefaults: () => defaults as never });
    // 생성 후 config가 로드된 상태를 모사.
    defaults = {
      chat_base_url: "http://localhost:8643/v1",
      stt_base_url: "http://localhost:5517/v1",
      tts_base_url: "http://localhost:8092",
      irodori_base_url: "http://localhost:8091",
      chat_model: "natsume",
    };
    qc.open();

    const ph = (key: string): string =>
      qc.el.querySelector<HTMLInputElement>(`.yui-input-row[data-ep-field="${key}"] .yui-ep-input`)!
        .placeholder;
    expect(ph("chat_base_url")).toBe("http://localhost:8643/v1");
    expect(ph("stt_base_url")).toBe("http://localhost:5517/v1");
    expect(ph("chat_model")).toBe("natsume");

    qc.dispose();
  });

  it("toggles inline invalid state on a url field via isValidEndpointUrl (empty = no error)", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="stt_base_url"] .yui-ep-input',
    )!;
    const row = input.closest<HTMLDivElement>(".yui-input-row")!;

    input.value = "localhost:5517"; // 스킴 없음 → invalid
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    input.value = "https://localhost:5517/v1"; // valid
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(false);

    input.value = ""; // 빈 값 = override 없음 → 에러 아님
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(false);

    qc.dispose();
  });

  it("persists an endpoint override into the store and per-section reset clears that section's fields", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="chat_base_url"] .yui-ep-input',
    )!;
    input.value = "https://api.example.com/v1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().chat_base_url).toBe("https://api.example.com/v1");

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="chat"]')!.click();
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });

  it("the chat reset clears chat_base_url + chat_model + chat_api + the chat key, leaving other sections intact", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-chat-1");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    endpointsSettings.set({
      chat_base_url: "https://c/v1",
      chat_model: "m",
      chat_api: "chat_completions",
      stt_base_url: "https://s",
    });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="chat"]')!.click();
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(endpointsSettings.get().chat_model).toBe("");
    expect(endpointsSettings.get().chat_api).toBe("");
    expect(chatKeySettings.get().apiKey).toBe("");
    // STT field is untouched by the chat reset.
    expect(endpointsSettings.get().stt_base_url).toBe("https://s");

    qc.dispose();
  });

  it("the tts reset clears irodori_base_url + tts_base_url + tts_voice + tts_provider + the tts key", () => {
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    ttsKeySettings.setApiKey("sk-tts-1");
    const qc = buildQc({ ttsKeySettings });
    qc.open();

    endpointsSettings.set({
      irodori_base_url: "http://i",
      tts_base_url: "http://t",
      tts_voice: "alloy",
      tts_provider: "openai",
    });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="tts"]')!.click();
    expect(endpointsSettings.get().irodori_base_url).toBe("");
    expect(endpointsSettings.get().tts_base_url).toBe("");
    expect(endpointsSettings.get().tts_voice).toBe("");
    expect(endpointsSettings.get().tts_provider).toBe("");
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("the stt reset clears stt_base_url and the stt key", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    sttKeySettings.setApiKey("sk-stt-1");
    const qc = buildQc({ sttKeySettings });
    qc.open();

    endpointsSettings.set({ stt_base_url: "https://stt.example.com/v1" });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="stt"]')!.click();
    expect(endpointsSettings.get().stt_base_url).toBe("");
    expect(sttKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  // ── chat API key field ────────────────────────────────────────────────────

  function chatKeyInput(qc: { el: HTMLElement }): HTMLInputElement {
    return qc.el.querySelector<HTMLInputElement>(".yui-chatkey__input")!;
  }

  it("renders a masked chat API-key field in the advanced panel with no autofill leakage", () => {
    const qc = buildQc();
    qc.open();

    const input = chatKeyInput(qc);
    expect(input).not.toBeNull();
    // Masked by default + no browser autofill of a secret.
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.hasAttribute("name")).toBe(false);
    // Lives in the advanced tab, near the endpoint rows (chat credential).
    const advPanel = qc.el.querySelector<HTMLElement>("#yui-panel-adv")!;
    expect(advPanel.contains(input)).toBe(true);

    qc.dispose();
  });

  it("prefills from the store and signals 'default in use' without revealing any value", () => {
    const chatKeySettings = createChatKeySettings();
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    // No override → empty field, never a placeholder/sublabel that leaks a value.
    expect(input.value).toBe("");
    const row = input.closest<HTMLDivElement>(".yui-input-row")!;
    const sub = row.querySelector<HTMLElement>(".yui-input-row__sub")!;
    expect(sub.textContent).toContain("기본값");
    // The field communicates default-in-use via copy, not by surfacing a secret.
    expect(input.placeholder).not.toContain("sk-");

    qc.dispose();
  });

  it("reflects an existing override as a masked value and 'saved' sublabel", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    // Value is present (so edits round-trip) but the field is masked.
    expect(input.value).toBe("sk-secret-123");
    expect(input.type).toBe("password");
    const sub = input
      .closest<HTMLDivElement>(".yui-input-row")!
      .querySelector<HTMLElement>(".yui-input-row__sub")!;
    expect(sub.textContent).not.toContain("기본값");

    qc.dispose();
  });

  it("does not persist intermediate prefixes per keystroke", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    for (const v of ["s", "sk", "sk-", "sk-typed-456"]) {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // No prefix ever reaches the store while typing.
    expect(setSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("commits the full key once on blur", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-typed-456";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Nothing persisted from typing alone.
    expect(setSpy).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-typed-456");
    expect(chatKeySettings.get().apiKey).toBe("sk-typed-456");

    qc.dispose();
  });

  it("blurring an emptied field calls clear() (empty = no override)", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Emptying alone does not clear the override.
    expect(clearSpy).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(clearSpy).toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("flushes a dirty typed key once on close() (never before close)", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-unblurred-789";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Typing without blur persists nothing yet.
    expect(setSpy).not.toHaveBeenCalled();

    qc.close();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-unblurred-789");
    expect(chatKeySettings.get().apiKey).toBe("sk-unblurred-789");

    qc.dispose();
  });

  it("flushes a dirty typed key on close() in the window variant", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings, variant: "window" });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-window-321";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setSpy).not.toHaveBeenCalled();

    qc.close();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-window-321");
    expect(chatKeySettings.get().apiKey).toBe("sk-window-321");

    qc.dispose();
  });

  it("flushes a dirty typed key on dispose() without a prior blur", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-disposed-654";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setSpy).not.toHaveBeenCalled();

    qc.dispose();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-disposed-654");
    expect(chatKeySettings.get().apiKey).toBe("sk-disposed-654");
  });

  it("emptying a set key then close() clears the override", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Emptying without blur does not clear yet.
    expect(clearSpy).not.toHaveBeenCalled();

    qc.close();
    expect(clearSpy).toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("close() does not commit when no typing occurred", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    qc.close();
    expect(setSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("sk-secret-123");

    qc.dispose();
  });

  it("a dedicated clear button empties the field and the store", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-chatkey__clear")!.click();
    expect(chatKeySettings.get().apiKey).toBe("");
    expect(chatKeyInput(qc).value).toBe("");

    qc.dispose();
  });

  it("the show/hide toggle flips the input between password and text", () => {
    const qc = buildQc();
    qc.open();

    const input = chatKeyInput(qc);
    const toggle = qc.el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    toggle.click();
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    qc.dispose();
  });

  it("subscribes to the store so cross-window edits reflect into the field", () => {
    const chatKeySettings = createChatKeySettings();
    const qc = buildQc({ chatKeySettings });
    qc.open();

    chatKeySettings.setApiKey("sk-from-other-window");
    expect(chatKeyInput(qc).value).toBe("sk-from-other-window");

    chatKeySettings.clear();
    expect(chatKeyInput(qc).value).toBe("");

    qc.dispose();
  });

  it("never writes the key value into the DOM text or attributes", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const row = chatKeyInput(qc).closest<HTMLDivElement>(".yui-input-row")!;
    // The secret may live only in input.value — never in rendered text or other attrs.
    expect(row.textContent).not.toContain("sk-secret-123");
    expect(row.innerHTML).not.toContain("sk-secret-123");

    qc.dispose();
  });

  // ── STT / TTS API key rows (mirror the chat key, own stores) ────────────────

  function keyInput(qc: { el: HTMLElement }, prefix: string): HTMLInputElement {
    return qc.el.querySelector<HTMLInputElement>(
      `.yui-input-row[data-key-prefix="${prefix}"] .yui-chatkey__input`,
    )!;
  }

  it("renders a masked STT key row in the STT section wired to the stt store", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    const setSpy = vi.spyOn(sttKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(sttKeySettings, "clear");
    const qc = buildQc({ sttKeySettings });
    qc.open();

    const input = keyInput(qc, "sttkey");
    expect(input.type).toBe("password");
    expect(qc.el.querySelector('details[data-svc="stt"]')!.contains(input)).toBe(true);

    input.value = "sk-stt-abc";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith("sk-stt-abc");
    expect(sttKeySettings.get().apiKey).toBe("sk-stt-abc");

    qc.el
      .querySelector<HTMLButtonElement>(
        '.yui-input-row[data-key-prefix="sttkey"] .yui-chatkey__clear',
      )!
      .click();
    expect(clearSpy).toHaveBeenCalled();
    expect(sttKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("renders a masked TTS key row in the openai sub-view wired to the tts store", () => {
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    const setSpy = vi.spyOn(ttsKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(ttsKeySettings, "clear");
    const qc = buildQc({ ttsKeySettings, getDefaultProvider: () => "openai" });
    qc.open();

    const input = keyInput(qc, "ttskey");
    expect(input.type).toBe("password");
    expect(qc.el.querySelector(".yui-tts-openai")!.contains(input)).toBe(true);

    input.value = "sk-tts-xyz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith("sk-tts-xyz");
    expect(ttsKeySettings.get().apiKey).toBe("sk-tts-xyz");

    qc.el
      .querySelector<HTMLButtonElement>(
        '.yui-input-row[data-key-prefix="ttskey"] .yui-chatkey__clear',
      )!
      .click();
    expect(clearSpy).toHaveBeenCalled();
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("the three key rows are independent: editing chat does not touch stt/tts", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    const qc = buildQc({ sttKeySettings, ttsKeySettings });
    qc.open();

    const chat = keyInput(qc, "chatkey");
    chat.value = "sk-chat-only";
    chat.dispatchEvent(new Event("input", { bubbles: true }));
    chat.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(sttKeySettings.get().apiKey).toBe("");
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  // ── TTS engine (tts_provider) dropdown + sub-views + broker URL row ─────────

  function ttsTypeSelect(qc: { el: HTMLElement }): HTMLSelectElement {
    return qc.el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  }

  it("renders an interactive TTS-engine dropdown (irodori/openai) in the TTS section", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    expect(sel).not.toBeNull();
    // lives in the advanced tab's TTS section, not the character panel.
    expect(qc.el.querySelector('#yui-panel-adv details[data-svc="tts"]')!.contains(sel)).toBe(true);
    expect(sel.classList.contains("yui-select--single")).toBe(false);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["irodori", "openai"]);

    qc.dispose();
  });

  it("reflects the effective provider on the dropdown: bundled default when no override", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();
    expect(ttsTypeSelect(qc).value).toBe("openai");
    qc.dispose();
  });

  it("reflects the effective provider on the dropdown: override wins over the default", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();
    expect(ttsTypeSelect(qc).value).toBe("openai");
    qc.dispose();
  });

  it("irodori sub-view shows the speaker picker + irodori URL and NO TTS key row", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const irodori = qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!;
    const openai = qc.el.querySelector<HTMLElement>(".yui-tts-openai")!;
    expect(irodori.hidden).toBe(false);
    expect(openai.hidden).toBe(true);
    // speaker picker relocated into the irodori sub-view.
    expect(irodori.querySelector(".yui-spk-scroll")).not.toBeNull();
    expect(
      irodori.querySelector('.yui-input-row[data-ep-field="irodori_base_url"]'),
    ).not.toBeNull();
    // no key row in the irodori sub-view.
    expect(irodori.querySelector('[data-key-prefix="ttskey"]')).toBeNull();
    // speaker controls are enabled for irodori.
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-spks-hint")!.hidden).toBe(true);

    qc.dispose();
  });

  it("selecting 'openai' toggles to the openai sub-view: tts_voice field + TTS key row, speaker hidden", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    sel.value = "openai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().tts_provider).toBe("openai");

    const irodori = qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!;
    const openai = qc.el.querySelector<HTMLElement>(".yui-tts-openai")!;
    expect(irodori.hidden).toBe(true);
    expect(openai.hidden).toBe(false);
    expect(openai.querySelector('.yui-input-row[data-ep-field="tts_voice"]')).not.toBeNull();
    expect(openai.querySelector('[data-key-prefix="ttskey"]')).not.toBeNull();
    // speaker picker disabled + hint shown while openai is effective.
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(true);
    expect(qc.el.querySelector(".yui-spk-foot")!.classList.contains("is-disabled")).toBe(true);
    const hint = qc.el.querySelector<HTMLElement>(".yui-spks-hint")!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("irodori 전용");

    qc.dispose();
  });

  it("selecting 'irodori' toggles back: speaker picker re-shown, hint hidden", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    sel.value = "irodori";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().tts_provider).toBe("irodori");

    expect(qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!.hidden).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-tts-openai")!.hidden).toBe(true);
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-spks-hint")!.hidden).toBe(true);

    qc.dispose();
  });

  it("binds the openai tts_voice field to the endpoints store", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="tts_voice"] .yui-ep-input',
    )!;
    input.value = "alloy";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().tts_voice).toBe("alloy");

    qc.dispose();
  });

  // ── Chat API type (chat_api) dropdown ───────────────────────────────────────

  function chatTypeSelect(qc: { el: HTMLElement }): HTMLSelectElement {
    return qc.el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  }

  it("renders an interactive Chat-API dropdown (responses/chat_completions) in the Chat section", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    const sel = chatTypeSelect(qc);
    expect(sel).not.toBeNull();
    expect(qc.el.querySelector('#yui-panel-adv details[data-svc="chat"]')!.contains(sel)).toBe(
      true,
    );
    expect(sel.classList.contains("yui-select--single")).toBe(false);
    expect(sel.disabled).toBe(false);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["responses", "chat_completions"]);

    qc.dispose();
  });

  it("reflects the effective chat_api on the dropdown: bundled default when no override", () => {
    const qc = buildQc({ getDefaultChatApi: () => "chat_completions" });
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("chat_completions");
    qc.dispose();
  });

  it("reflects the effective chat_api on the dropdown: override wins over the default", () => {
    endpointsSettings.set({ chat_api: "chat_completions" });
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("chat_completions");
    qc.dispose();
  });

  it("falls back to 'responses' when no override and no default is available", () => {
    const qc = buildQc();
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("responses");
    qc.dispose();
  });

  it("selecting 'chat_completions' persists the override and updates the summary hint", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    const sel = chatTypeSelect(qc);
    sel.value = "chat_completions";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().chat_api).toBe("chat_completions");

    const hint = qc.el.querySelector<HTMLElement>(".yui-chat-summary-hint")!;
    expect(hint.textContent).not.toBe("");
    expect(hint.textContent).not.toBe(qc.el.querySelector(".yui-tts-summary-hint")!.textContent);

    qc.dispose();
  });

  it("selecting 'responses' toggles back and persists the override", () => {
    endpointsSettings.set({ chat_api: "chat_completions" });
    const qc = buildQc({ getDefaultChatApi: () => "chat_completions" });
    qc.open();

    const sel = chatTypeSelect(qc);
    sel.value = "responses";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().chat_api).toBe("responses");

    qc.dispose();
  });

  it("renders a broker_base_url endpoint row that persists and clears on the broker reset", () => {
    const qc = buildQc();
    qc.open();

    const row = qc.el.querySelector<HTMLDivElement>(
      '.yui-input-row[data-ep-field="broker_base_url"]',
    );
    expect(row).not.toBeNull();
    const input = row!.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input.classList.contains("yui-ep-input--url")).toBe(true);

    input.value = "http://localhost:3201/mcp";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().broker_base_url).toBe("http://localhost:3201/mcp");

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="broker"]')!.click();
    expect(endpointsSettings.get().broker_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });

  // ── reflect store state on open ───────────────────────────────────────────

  it("open() reflects the store's reasoning_effort and instructions", () => {
    agentSettings.setReasoningEffort("medium");
    agentSettings.setInstructions("hello world");

    const qc = buildQc();
    qc.open();

    const btns = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[3].getAttribute("aria-checked")).toBe("true"); // medium
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.value).toBe("hello world");

    qc.dispose();
  });

  it("external agent settings change reflects in the panel while open", () => {
    const qc = buildQc();
    qc.open();

    agentSettings.setReasoningEffort("low");
    agentSettings.setInstructions("changed externally");

    const btns = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[2].getAttribute("aria-checked")).toBe("true"); // low

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.value).toBe("changed externally");

    qc.dispose();
  });

  it("does not overwrite the instructions textarea while it is focused", () => {
    const qc = buildQc();
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    ta.focus();
    ta.value = "user is mid-edit";

    agentSettings.setInstructions("remote clobber");

    expect(ta.value).toBe("user is mid-edit");

    qc.dispose();
  });

  it("applies a deferred cross-window instructions change on blur", () => {
    const qc = buildQc();
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    ta.focus();

    agentSettings.setInstructions("remote value");
    expect(ta.value).not.toBe("remote value");

    ta.blur();
    expect(ta.value).toBe("remote value");

    qc.dispose();
  });

  // ── pop-out button ────────────────────────────────────────────────────────

  it("clicking the pop-out button invokes onPopOut", () => {
    const qc = buildQc();
    qc.open();

    const popout = qc.el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout")!;
    popout.click();

    expect(onPopOut).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("clicking the header close button closes the panel", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.isOpen()).toBe(true);

    const closeBtn = qc.el.querySelector<HTMLButtonElement>(
      ".yui-quick__bar-actions .yui-iconbtn:not(.yui-iconbtn--popout)",
    )!;
    closeBtn.click();

    expect(qc.isOpen()).toBe(false);

    qc.dispose();
  });

  // ── drag persistence ──────────────────────────────────────────────────────

  it("dragging the header persists position to localStorage and moves the panel", () => {
    const qc = buildQc();
    qc.open({ x: 100, y: 100 });

    const bar = qc.el.querySelector<HTMLElement>(".yui-quick__bar")!;
    bar.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 110, button: 0 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 170, clientY: 160 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 170, clientY: 160 }),
    );

    // moved by (+50, +50) from the open anchor (100,100) → (150,150)
    expect(qc.el.style.left).toBe("150px");
    expect(qc.el.style.top).toBe("150px");

    const raw = globalThis.localStorage?.getItem("yui.quick.pos");
    expect(raw).toBeTruthy();
    const pos = JSON.parse(raw!);
    expect(pos.x).toBe(150);
    expect(pos.y).toBe(150);

    qc.dispose();
  });

  it("open() with a saved position uses it over the cursor anchor", () => {
    globalThis.localStorage?.setItem("yui.quick.pos", JSON.stringify({ x: 222, y: 188 }));

    const qc = buildQc();
    qc.open({ x: 10, y: 10 });

    expect(qc.el.style.left).toBe("222px");
    expect(qc.el.style.top).toBe("188px");

    qc.dispose();
  });

  // ── window variant ────────────────────────────────────────────────────────

  it("variant 'window' renders no scrim and no pop-out button", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(mount.querySelector(".yui-quick-scrim")).toBeNull();
    expect(qc.el.querySelector(".yui-iconbtn--popout")).toBeNull();

    // still has the agent controls
    expect(qc.el.querySelector(".yui-seg")).not.toBeNull();
    expect(qc.el.querySelector(".yui-textarea")).not.toBeNull();

    qc.dispose();
  });

  // ── window variant: native titlebar is the only header ───────────────────

  it("window variant renders NO custom .yui-quick__bar (native titlebar owns the header)", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-quick__bar")).toBeNull();

    qc.dispose();
  });

  it("popover variant retains the .yui-quick__bar with grip + title + popout + close", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();

    const bar = qc.el.querySelector<HTMLElement>(".yui-quick__bar");
    expect(bar).not.toBeNull();
    expect(bar!.querySelector(".yui-quick__grip")).not.toBeNull();
    expect(bar!.querySelector(".yui-quick__title")).not.toBeNull();
    expect(bar!.querySelector(".yui-iconbtn--popout")).not.toBeNull();
    expect(bar!.querySelector(".yui-iconbtn--close")).not.toBeNull();

    qc.dispose();
  });

  // ── Escape — both variants must close ─────────────────────────────────────

  it("Escape closes the popover variant", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();
    expect(qc.isOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(qc.isOpen()).toBe(false);

    qc.dispose();
  });

  it("Escape in the window variant invokes the host's OS-window close path", () => {
    const onCloseWindow = vi.fn<() => void>();
    const qc = buildQc({ variant: "window", onCloseWindow });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCloseWindow).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("Escape in the window variant flushes a dirty typed key before closing", () => {
    const chatKeySettings = createChatKeySettings();
    const onCloseWindow = vi.fn<() => void>();
    const qc = buildQc({ chatKeySettings, variant: "window", onCloseWindow });

    const input = qc.el.querySelector<HTMLInputElement>(
      ".yui-input-row[data-key-prefix='chatkey'] .yui-chatkey__input",
    )!;
    input.value = "sk-escape-999";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(chatKeySettings.get().apiKey).toBe("sk-escape-999");
    expect(onCloseWindow).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  // ── VRM section ─────────────────────────────────────────────────────────────

  // microtask flush — swapVrm is async; let its promise settle before asserting.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it("renders one .yui-vrm radio per vrmSelection.list() entry", () => {
    const qc = buildQc();
    qc.open();

    const group = qc.el.querySelector<HTMLElement>(".yui-vrms[role=radiogroup]");
    expect(group).not.toBeNull();
    const rows = group!.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]");
    expect(rows).toHaveLength(3); // carlotta · aria · mirai
    const names = Array.from(rows).map((r) => r.querySelector(".yui-vrm__name")!.textContent);
    expect(names).toEqual(["Carlotta", "Aria", "Mirai"]);

    qc.dispose();
  });

  it("marks the active row aria-checked and shows the '사용 중' badge", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Carlotta");
    expect(active.querySelector(".yui-vrm__badge")!.textContent).toBe("사용 중");
    // non-active rows carry no badge
    for (const r of rows) {
      if (r !== active) expect(r.querySelector(".yui-vrm__badge")).toBeNull();
    }

    qc.dispose();
  });

  it("clicking a non-active row calls swapVrm with that option and shows loading", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const aria = rows[1]; // Aria
    aria.click();

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "aria", url: "/vrms/aria.vrm" });

    // loading reflected immediately (before the promise resolves)
    expect(aria.getAttribute("aria-busy")).toBe("true");
    expect(aria.querySelector(".yui-vrm__hint")!.textContent).toContain("바꾸는 중");
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(true);

    qc.dispose();
  });

  it("on resolve the active tick + badge move to the new row and loading clears", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[1].click(); // Aria
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Aria");
    expect(active.querySelector(".yui-vrm__badge")!.textContent).toBe("사용 중");
    // loading cleared everywhere
    expect(qc.el.querySelector(".yui-vrm[aria-busy=true]")).toBeNull();
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    expect(group.getAttribute("aria-busy")).not.toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(false);
    expect(vrmSelection.getActiveId()).toBe("aria");

    qc.dispose();
  });

  it("on reject shows the inline error and leaves the active selection unchanged", async () => {
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async () => {
      throw new Error("load failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[2].click(); // Mirai
    await flush();

    const errorRow = qc.el.querySelector<HTMLButtonElement>(".yui-vrm.is-error")!;
    expect(errorRow.querySelector(".yui-vrm__name")!.textContent).toBe("Mirai");
    const errMsg = qc.el.querySelector(".yui-vrm__error")!;
    expect(errMsg.textContent).toContain("불러오지 못했어요");
    // active stays Carlotta (store never changed)
    expect(vrmSelection.getActiveId()).toBe("carlotta");
    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Carlotta");
    // loading cleared
    expect(qc.el.querySelector(".yui-vrm[aria-busy=true]")).toBeNull();

    qc.dispose();
  });

  it("clicking the already-active row is a no-op (no swapVrm)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    active.click();

    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("the '파일에서 추가…' row is enabled and invokes the import handler on click", () => {
    const qc = buildQc();
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
    expect(add.disabled).toBe(false);
    expect(add.hasAttribute("aria-disabled")).toBe(false);
    expect(add.classList.contains("is-ready")).toBe(true);
    // the 준비 중 chip is gone now that import is wired
    expect(add.querySelector(".yui-vrm__soon")).toBeNull();
    // it is NOT a radio (excluded from the radiogroup roving order)
    expect(add.getAttribute("role")).not.toBe("radio");

    add.click();
    expect(importVrm).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("caps the list in a scroll container; the add-row footer lives OUTSIDE it", () => {
    const qc = buildQc();
    qc.open();

    const scroll = qc.el.querySelector<HTMLElement>(".yui-vrm-scroll")!;
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    const foot = qc.el.querySelector<HTMLElement>(".yui-vrm-foot")!;
    // the radiogroup is inside the capped scroll container
    expect(scroll.contains(group)).toBe(true);
    // the pinned footer (and its add-row) is NOT inside the scroll container
    expect(scroll.contains(foot)).toBe(false);
    expect(foot.querySelector(".yui-vrm--add")).not.toBeNull();

    qc.dispose();
  });

  it("ArrowDown on the VRM radiogroup moves roving focus to the next row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    // active is row 0 (Carlotta); ArrowDown → roving focus to row 1 (Aria), no commit
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
    // manual activation: roving moves focus only — selection (aria-checked) must not follow
    expect(rows[1].getAttribute("aria-checked")).toBe("false");
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(swapVrm).not.toHaveBeenCalled();
    expect(vrmSelection.getActiveId()).toBe("carlotta");

    qc.dispose();
  });

  it("Enter on a focused non-active VRM row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "aria" });

    qc.dispose();
  });

  it("Space on a focused non-active VRM row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "mirai" });

    qc.dispose();
  });

  it("renders a label with HTML metacharacters as literal text (no innerHTML injection)", () => {
    const evil = "a<img src=x onerror=alert(1)>b";
    vrmSelection = createVrmSelection({
      available: [{ id: "carlotta", label: evil, url: "/vrms/carlotta.vrm", source: "bundled" }],
      defaultUrl: "/vrms/carlotta.vrm",
    });
    const qc = buildQc();
    qc.open();

    const name = qc.el.querySelector<HTMLElement>(".yui-vrm[role=radio] .yui-vrm__name")!;
    expect(name.textContent).toBe(evil);
    // no element was parsed from the label — proves textContent, not innerHTML
    expect(name.querySelector("img")).toBeNull();
    expect(qc.el.querySelector(".yui-vrms img")).toBeNull();

    qc.dispose();
  });

  it("End key on the VRM radiogroup moves roving focus to the last row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(document.activeElement).toBe(rows[2]);
    expect(rows[2].tabIndex).toBe(0);
    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("keeps the roving VRM tabindex on the last-roved row across a re-render", async () => {
    // A rejected commit on a different row re-renders (finally → renderVrms) while the
    // active id stays put — the seam that proves roving-tabindex survives a real re-render.
    swapVrm = vi.fn(async () => {
      throw new Error("load failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    // rove down to Aria (unchecked) without committing → vrmRovedId = aria
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[1].tabIndex).toBe(0);

    // commit Mirai (a DIFFERENT row than the roved Aria); its swap REJECTS, so active stays
    // carlotta but finally still re-renders. A wrong rovedId re-point on commit would move
    // the tab stop to Mirai — this asserts it stays on the roved Aria.
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    expect(vrmSelection.getActiveId()).toBe("carlotta"); // rejected swap left active untouched
    // roving tabindex must remain on Aria — not snap to the checked Carlotta, nor to Mirai
    expect(after[1].tabIndex).toBe(0);
    expect(after[0].tabIndex).toBe(-1);
    expect(after[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("reflects an external vrmSelection change (cross-window) while open", () => {
    const qc = buildQc();
    qc.open();

    // simulate another window committing a selection
    vrmSelection.select("mirai");

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Mirai");

    qc.dispose();
  });

  it("window variant also renders the VRM section", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-vrms[role=radiogroup]")).not.toBeNull();
    expect(qc.el.querySelector(".yui-vrm--add")).not.toBeNull();

    qc.dispose();
  });

  // ── BYO-VRM: user rows + import + rename + remove ───────────────────────────

  // Selection holding the three bundled rows plus one user (imported) option.
  function withUserOption() {
    vrmSelection = makeVrmSelection();
    vrmSelection.addUserOption(USER_OPTION);
  }

  function userRow(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`.yui-vrm[data-vrm-id="${USER_OPTION.id}"]`)!;
  }

  it("renders a user option as a div[role=radio] row carrying rename + remove controls", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    const row = userRow(qc);
    expect(row).not.toBeNull();
    // nested buttons require a div row, never a <button> (invalid nested HTML)
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBe("radio");
    expect(row.querySelector(".yui-vrm__name")!.textContent).toBe("깜냥이");
    expect(row.querySelector<HTMLButtonElement>(".yui-vrm__rename")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-vrm__remove")).not.toBeNull();

    qc.dispose();
  });

  it("bundled rows stay <button> radios with no rename/remove controls", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    const carlotta = qc.el.querySelector<HTMLElement>('.yui-vrm[data-vrm-id="carlotta"]')!;
    expect(carlotta.tagName).toBe("BUTTON");
    expect(carlotta.querySelector(".yui-vrm__rename")).toBeNull();
    expect(carlotta.querySelector(".yui-vrm__remove")).toBeNull();

    qc.dispose();
  });

  it("pencil opens inline rename; Enter commits via renameUserOption", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__rename")!.click();

    // entering rename re-renders — re-query the now-renaming row
    const row = userRow(qc);
    expect(row.classList.contains("yui-vrm--renaming")).toBe(true);
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("깜냥이");
    expect(row.querySelector(".yui-vrm__rename-hint")).not.toBeNull();

    input.value = "냥이";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(vrmSelection.getOptions().find((o) => o.id === "cat")!.label).toBe("냥이");
    // input is gone after commit
    expect(userRow(qc).querySelector(".yui-ep-input")).toBeNull();

    qc.dispose();
  });

  it("Esc cancels inline rename without changing the label", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__rename")!.click();
    const input = userRow(qc).querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = "버려질 이름";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(vrmSelection.getOptions().find((o) => o.id === "cat")!.label).toBe("깜냥이");
    expect(userRow(qc).querySelector(".yui-ep-input")).toBeNull();
    // Esc cancels the rename only — it must NOT close the whole panel
    expect(qc.isOpen()).toBe(true);

    qc.dispose();
  });

  it("trash removes the option via removeUserVrm then store removeUserOption", async () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    expect(removeUserVrm).toHaveBeenCalledOnce();
    expect(removeUserVrm.mock.calls[0][0]).toBe("cat");
    expect(vrmSelection.getOptions().map((o) => o.id)).not.toContain("cat");
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).toBeNull();

    qc.dispose();
  });

  it("deletes the file BEFORE committing the store removal (no divergence ordering)", async () => {
    withUserOption();
    let storeStillHadCatAtDelete: boolean | null = null;
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      // at the moment the native delete runs, the store must not have committed yet.
      storeStillHadCatAtDelete = vrmSelection.getOptions().some((o) => o.id === "cat");
    });
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    expect(storeStillHadCatAtDelete).toBe(true);
    expect(vrmSelection.getOptions().map((o) => o.id)).not.toContain("cat");

    qc.dispose();
  });

  it("keeps the entry in the store when the native file delete fails (no divergence)", async () => {
    withUserOption();
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // file delete failed → store must NOT have dropped the entry; row stays visible.
    expect(vrmSelection.getOptions().map((o) => o.id)).toContain("cat");
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).not.toBeNull();

    qc.dispose();
  });

  it("does NOT fall back / swap the renderer when deleting the active VRM file fails", async () => {
    withUserOption();
    vrmSelection.select("cat");
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc();
    qc.open();
    swapVrm.mockClear();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // store still active on cat, no fallback swap attempted.
    expect(vrmSelection.getActiveId()).toBe("cat");
    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("removing the active user VRM falls back to default and swaps the renderer", async () => {
    withUserOption();
    vrmSelection.select("cat");
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // store fell back to the bundled default
    expect(vrmSelection.getActiveId()).toBe("carlotta");
    // renderer reloaded onto the fallback
    expect(swapVrm).toHaveBeenCalled();
    expect(swapVrm.mock.calls.at(-1)![0]).toMatchObject({ id: "carlotta" });

    qc.dispose();
  });

  it("clicking the add button enters the importing state (loading row)", () => {
    // import handler that never resolves — pins the transient importing row
    importVrm = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();

    const loading = qc.el.querySelector<HTMLElement>(".yui-vrm__loading")!;
    expect(loading).not.toBeNull();
    expect(loading.querySelector(".yui-vrm__spin")).not.toBeNull();
    expect(loading.querySelector(".yui-vrm__loading-name")!.textContent).toContain("불러오는 중");

    qc.dispose();
  });

  it("a failed import shows the inline error and clears the importing row", async () => {
    importVrm = vi.fn<() => Promise<void>>(async () => {
      throw new Error("bad vrm");
    });
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();
    await flush();

    const err = qc.el.querySelector<HTMLElement>(".yui-vrm__import-error")!;
    expect(err).not.toBeNull();
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain("불러올 수 없는 파일이에요");
    // the transient loading row is gone once the import settles
    expect(qc.el.querySelector(".yui-vrm__loading")).toBeNull();

    qc.dispose();
  });

  it("a successful import clears the importing row and error notice", async () => {
    importVrm = vi.fn<() => Promise<void>>(async () => {
      vrmSelection.addUserOption(USER_OPTION);
    });
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();
    await flush();

    expect(qc.el.querySelector(".yui-vrm__loading")).toBeNull();
    expect(qc.el.querySelector<HTMLElement>(".yui-vrm__import-error")!.hidden).toBe(true);
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).not.toBeNull();

    qc.dispose();
  });

  // ── 화자 (Speaker) section (PR-B B3) ─────────────────────────────────────────

  it("renders one .yui-spk radio per speakerSelection.list() entry", () => {
    const qc = buildQc();
    qc.open();

    const group = qc.el.querySelector<HTMLElement>(".yui-spks[role=radiogroup]");
    expect(group).not.toBeNull();
    const rows = group!.querySelectorAll<HTMLElement>(".yui-spk[role=radio]");
    expect(rows).toHaveLength(3); // natsume · ayase · rena
    const names = Array.from(rows).map((r) => r.querySelector(".yui-spk__name")!.textContent);
    expect(names).toEqual(["Natsume", "Ayase", "Rena"]);

    qc.dispose();
  });

  it("the speaker section sits AFTER the VRM section", () => {
    const qc = buildQc();
    qc.open();

    const vrmGroup = qc.el.querySelector(".yui-vrms[role=radiogroup]")!;
    const spkGroup = qc.el.querySelector(".yui-spks[role=radiogroup]")!;
    // DOCUMENT_POSITION_FOLLOWING (4) → spkGroup comes after vrmGroup in document order
    expect(
      vrmGroup.compareDocumentPosition(spkGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    qc.dispose();
  });

  it("marks the active speaker row aria-checked and shows the '사용 중' badge", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Natsume");
    expect(active.querySelector(".yui-spk__badge")!.textContent).toBe("사용 중");
    for (const r of rows) {
      if (r !== active) expect(r.querySelector(".yui-spk__badge")).toBeNull();
    }

    qc.dispose();
  });

  it("roving tabindex: active speaker row tabindex=0, others -1", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows[0].tabIndex).toBe(0); // active (natsume)
    expect(rows[1].tabIndex).toBe(-1);
    expect(rows[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("clicking a non-active speaker row calls swapSpeaker with that option and shows loading", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const ayase = rows[1];
    ayase.click();

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({
      id: "ayase",
      ref_url: "/references/ayase.wav",
    });

    // loading reflected immediately (before the promise resolves)
    expect(ayase.getAttribute("aria-busy")).toBe("true");
    expect(ayase.querySelector(".yui-spk__hint")!.textContent).toContain("바꾸는 중");
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(true);

    qc.dispose();
  });

  it("on resolve the active tick + badge move to the new speaker row and loading clears", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].click(); // Ayase
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Ayase");
    expect(active.querySelector(".yui-spk__badge")!.textContent).toBe("사용 중");
    expect(qc.el.querySelector(".yui-spk[aria-busy=true]")).toBeNull();
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    expect(group.getAttribute("aria-busy")).not.toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(false);
    expect(speakerSelection.getActiveId()).toBe("ayase");

    qc.dispose();
  });

  it("on reject shows the inline speaker error and leaves the active selection unchanged", async () => {
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {
      throw new Error("clone failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].click(); // Rena
    await flush();

    const errorRow = qc.el.querySelector<HTMLElement>(".yui-spk.is-error")!;
    expect(errorRow.querySelector(".yui-spk__name")!.textContent).toBe("Rena");
    const errMsg = qc.el.querySelector(".yui-spk__error")!;
    expect(errMsg.textContent).toContain("불러오지 못했어요");
    expect(speakerSelection.getActiveId()).toBe("natsume");
    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Natsume");
    expect(qc.el.querySelector(".yui-spk[aria-busy=true]")).toBeNull();

    qc.dispose();
  });

  it("clicking the already-active speaker row is a no-op (no swapSpeaker)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    active.click();

    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("the speaker '파일에서 추가…' row is an enabled button (irodori) and click invokes importVoice", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
    expect(add.disabled).toBe(false);
    expect(add.getAttribute("role")).not.toBe("radio");
    expect(add.querySelector(".yui-spk__soon")).toBeNull(); // no "준비 중" chip anymore

    add.click();
    expect(importVoice).toHaveBeenCalledOnce();
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  // ── 화자: user (imported) voice management — mirrors the VRM section ─────────

  function withUserVoice() {
    speakerSelection = makeSpeakerSelection();
    speakerSelection.addUserVoice(USER_VOICE);
  }

  function userSpkRow(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`.yui-spk[data-spk-id="${USER_VOICE.id}"]`)!;
  }

  it("renders a user voice row carrying rename + remove + audition controls", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const row = userSpkRow(qc);
    expect(row).not.toBeNull();
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBe("radio");
    expect(row.querySelector(".yui-spk__name")!.textContent).toBe("내 목소리");
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__rename")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__remove")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__preview")).not.toBeNull();

    qc.dispose();
  });

  it("bundled speaker rows carry no rename/remove controls", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const natsume = qc.el.querySelector<HTMLElement>('.yui-spk[data-spk-id="natsume"]')!;
    expect(natsume.querySelector(".yui-spk__rename")).toBeNull();
    expect(natsume.querySelector(".yui-spk__remove")).toBeNull();
    // bundled still has refresh + preview
    expect(natsume.querySelector(".yui-spk__preview")).not.toBeNull();

    qc.dispose();
  });

  it("pencil opens inline rename; Enter commits via renameUserVoice", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__rename")!.click();

    const row = userSpkRow(qc);
    expect(row.classList.contains("yui-spk--renaming")).toBe(true);
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("내 목소리");
    expect(row.querySelector(".yui-spk__rename-hint")).not.toBeNull();

    input.value = "새 목소리";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.getOptions().find((o) => o.id === "myvoice")!.label).toBe("새 목소리");
    expect(userSpkRow(qc).querySelector(".yui-ep-input")).toBeNull();

    qc.dispose();
  });

  it("Esc cancels inline speaker rename without changing the label or closing the panel", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__rename")!.click();
    const input = userSpkRow(qc).querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = "버려질 이름";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(speakerSelection.getOptions().find((o) => o.id === "myvoice")!.label).toBe("내 목소리");
    expect(userSpkRow(qc).querySelector(".yui-ep-input")).toBeNull();
    expect(qc.isOpen()).toBe(true);

    qc.dispose();
  });

  it("trash removes the voice via injected removeUserVoice then store removeUserVoice", async () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(removeUserVoice).toHaveBeenCalledOnce();
    expect(removeUserVoice.mock.calls[0][0]).toBe("myvoice");
    expect(speakerSelection.getOptions().map((o) => o.id)).not.toContain("myvoice");
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).toBeNull();

    qc.dispose();
  });

  it("deletes the voice file BEFORE committing the store removal (no divergence ordering)", async () => {
    withUserVoice();
    let storeStillHadVoiceAtDelete: boolean | null = null;
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      storeStillHadVoiceAtDelete = speakerSelection.getOptions().some((o) => o.id === "myvoice");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(storeStillHadVoiceAtDelete).toBe(true);
    expect(speakerSelection.getOptions().map((o) => o.id)).not.toContain("myvoice");

    qc.dispose();
  });

  it("keeps the voice in the store when the native file delete fails (no divergence)", async () => {
    withUserVoice();
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(speakerSelection.getOptions().map((o) => o.id)).toContain("myvoice");
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).not.toBeNull();

    qc.dispose();
  });

  it("does NOT fall back / swap the speaker when deleting the active voice file fails", async () => {
    withUserVoice();
    speakerSelection.select("myvoice");
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();
    swapSpeaker.mockClear();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(speakerSelection.getActiveId()).toBe("myvoice");
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("removing the active user voice falls back to default and swaps the speaker", async () => {
    withUserVoice();
    speakerSelection.select("myvoice");
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    // store fell back to the bundled default
    expect(speakerSelection.getActiveId()).toBe("natsume");
    // speaker reloaded onto the fallback
    expect(swapSpeaker).toHaveBeenCalled();
    expect(swapSpeaker.mock.calls.at(-1)![0]).toMatchObject({ id: "natsume" });

    qc.dispose();
  });

  it("clicking add enters the importing state (loading row)", () => {
    importVoice = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();

    const loading = qc.el.querySelector<HTMLElement>(".yui-spk__loading")!;
    expect(loading).not.toBeNull();
    expect(loading.querySelector(".yui-spk__spin")).not.toBeNull();
    expect(loading.querySelector(".yui-spk__loading-name")!.textContent).toContain("불러오는 중");

    qc.dispose();
  });

  it("a failed voice import shows the inline error and clears the importing row", async () => {
    importVoice = vi.fn<() => Promise<void>>(async () => {
      throw new Error("bad voice");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    await flush();

    const err = qc.el.querySelector<HTMLElement>(".yui-spk__import-error")!;
    expect(err).not.toBeNull();
    expect(err.hidden).toBe(false);
    expect(qc.el.querySelector(".yui-spk__loading")).toBeNull();

    qc.dispose();
  });

  it("a successful voice import clears the importing row and error notice", async () => {
    importVoice = vi.fn<() => Promise<void>>(async () => {
      speakerSelection.addUserVoice(USER_VOICE);
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    await flush();

    expect(qc.el.querySelector(".yui-spk__loading")).toBeNull();
    expect(qc.el.querySelector<HTMLElement>(".yui-spk__import-error")!.hidden).toBe(true);
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).not.toBeNull();

    qc.dispose();
  });

  it("when provider=openai the add button does not import and user controls are absent", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    // whole speaker section disabled (pointer-events:none via .is-disabled)
    const foot = qc.el.querySelector<HTMLElement>(".yui-spk-foot")!;
    expect(foot.classList.contains("is-disabled")).toBe(true);
    const scroll = qc.el.querySelector<HTMLElement>(".yui-spk-scroll")!;
    expect(scroll.classList.contains("is-disabled")).toBe(true);

    // even if the click handler fires, it must not import while openai is effective
    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    expect(importVoice).not.toHaveBeenCalled();

    // a remove click on a user row must not delete while openai is effective
    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    expect(removeUserVoice).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("caps the speaker list in a scroll container; the add-row footer lives OUTSIDE it", () => {
    const qc = buildQc();
    qc.open();

    const scroll = qc.el.querySelector<HTMLElement>(".yui-spk-scroll")!;
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    const foot = qc.el.querySelector<HTMLElement>(".yui-spk-foot")!;
    expect(scroll.contains(group)).toBe(true);
    expect(scroll.contains(foot)).toBe(false);
    expect(foot.querySelector(".yui-spk--add")).not.toBeNull();

    qc.dispose();
  });

  it("openai gates the speaker option buttons with the real disabled attribute", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__refresh")!.disabled).toBe(true);
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__preview")!.disabled).toBe(true);
    }

    qc.dispose();
  });

  it("irodori leaves clip-backed speaker option buttons enabled (not disabled)", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    // default speakers all carry a ref_url (clip) → option buttons are enabled.
    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    for (const r of rows) {
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__refresh")!.disabled).toBe(false);
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__preview")!.disabled).toBe(false);
    }

    qc.dispose();
  });

  it("switching the engine to openai while open disables the speaker option buttons", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const refreshBefore = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshBefore.disabled).toBe(false);

    const sel = qc.el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
    sel.value = "openai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    const refreshAfter = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshAfter.disabled).toBe(true);

    qc.dispose();
  });

  it("Enter on a focused non-active speaker row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "ayase" });

    qc.dispose();
  });

  it("Space on a focused non-active speaker row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "rena" });

    qc.dispose();
  });

  it("ArrowDown moves roving focus to the next speaker row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    // roving focus moved; selection unchanged until Enter/Space
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
    // manual activation: roving moves focus only — selection (aria-checked) must not follow
    expect(rows[1].getAttribute("aria-checked")).toBe("false");
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(swapSpeaker).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("ArrowUp wraps roving focus from the first to the last speaker row", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    expect(document.activeElement).toBe(rows[2]);

    qc.dispose();
  });

  it("keeps the roving speaker tabindex on the last-roved row across a re-render", async () => {
    // A rejected commit on a different row re-renders (finally → renderSpeakers) while the
    // active id stays put — the seam that proves roving-tabindex survives a real re-render.
    swapSpeaker = vi.fn(async () => {
      throw new Error("swap failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    // rove down to Ayase (unchecked) without committing → spkRovedId = ayase
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[1].tabIndex).toBe(0);

    // commit Rena (a DIFFERENT row than the roved Ayase); its swap REJECTS, so active stays
    // natsume but finally still re-renders. A wrong rovedId re-point on commit would move
    // the tab stop to Rena — this asserts it stays on the roved Ayase.
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(speakerSelection.getActiveId()).toBe("natsume"); // rejected swap left active untouched
    // roving tabindex must remain on Ayase — not snap to the checked Natsume, nor to Rena
    expect(after[1].tabIndex).toBe(0);
    expect(after[0].tabIndex).toBe(-1);
    expect(after[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("clicking the ▶ preview button does NOT trigger row selection", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const preview = rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    expect(preview).not.toBeNull();
    preview.click();

    // the preview audition must not select/swap the row
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("routes the audition url through the asset resolver before constructing Audio", async () => {
    const resolveAuditionUrl = vi.fn(async (u: string) => `resolved://${u}`);
    const seen: string[] = [];
    class FakeAudio {
      src: string;
      constructor(src: string) {
        this.src = src;
        seen.push(src);
      }
      addEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const OrigAudio = globalThis.Audio;
    (globalThis as { Audio: unknown }).Audio = FakeAudio as unknown;
    try {
      const qc = buildQc({ resolveAuditionUrl });
      qc.open();

      const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
      rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!.click();
      await flush();

      expect(resolveAuditionUrl).toHaveBeenCalledWith("/references/ayase.wav");
      expect(seen).toEqual(["resolved:///references/ayase.wav"]);

      qc.dispose();
    } finally {
      (globalThis as { Audio: unknown }).Audio = OrigAudio;
    }
  });

  it("disables the ▶ preview button when a speaker has an empty ref_url", () => {
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: "noclip", label: "Noclip", ref_url: "" },
      ],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const withClip = rows[0].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    const noClip = rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    expect(withClip.disabled).toBe(false);
    expect(noClip.disabled).toBe(true);

    qc.dispose();
  });

  it("reflects an external speakerSelection change (cross-window) while open", () => {
    const qc = buildQc();
    qc.open();

    speakerSelection.select("rena");

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Rena");

    qc.dispose();
  });

  it("renders a speaker label with HTML metacharacters as literal text (no innerHTML injection)", () => {
    const evil = "a<img src=x onerror=alert(1)>b";
    speakerSelection = createSpeakerSelection({
      available: [{ id: "natsume", label: evil, ref_url: "/references/natsume.wav" }],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const name = qc.el.querySelector<HTMLElement>(".yui-spk[role=radio] .yui-spk__name")!;
    expect(name.textContent).toBe(evil);
    expect(name.querySelector("img")).toBeNull();
    expect(qc.el.querySelector(".yui-spks img")).toBeNull();

    qc.dispose();
  });

  it("activates a speaker whose id contains a double-quote without throwing (CSS.escape)", async () => {
    const evilId = 'ナ"ツメ';
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: evilId, label: "Quoted", ref_url: "/references/quoted.wav" },
      ],
      defaultId: "natsume",
    });
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const quoted = rows.find((r) => r.dataset.spkId === evilId)!;
    expect(quoted).toBeDefined();

    // clicking would throw SyntaxError inside spkRowById if the selector were unescaped
    expect(() => quoted.click()).not.toThrow();
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.dataset.spkId).toBe(evilId);
    expect(speakerSelection.getActiveId()).toBe(evilId);

    qc.dispose();
  });

  it("window variant also renders the speaker section", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-spks[role=radiogroup]")).not.toBeNull();
    expect(qc.el.querySelector(".yui-spk--add")).not.toBeNull();

    qc.dispose();
  });

  // ── 화자 행 참조-음성 갱신(refresh) 버튼 ────────────────────────────────────

  it("renders a .yui-spk__refresh button per speaker row, before the ▶ preview", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const refresh = r.querySelector<HTMLButtonElement>(".yui-spk__refresh");
      const preview = r.querySelector<HTMLButtonElement>(".yui-spk__preview");
      expect(refresh).not.toBeNull();
      expect(preview).not.toBeNull();
      // refresh sits BEFORE preview in source/visual order
      expect(
        refresh!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    qc.dispose();
  });

  it("disables the refresh button when a speaker has an empty ref_url", () => {
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: "noclip", label: "Noclip", ref_url: "" },
      ],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const withClip = rows[0].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    const noClip = rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    expect(withClip.disabled).toBe(false);
    expect(noClip.disabled).toBe(true);

    qc.dispose();
  });

  it("clicking the refresh button calls refreshSpeaker and does NOT change the active selection", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const ayase = rows[1]; // non-active
    const refresh = ayase.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    refresh.click();

    expect(refreshSpeaker).toHaveBeenCalledOnce();
    expect(refreshSpeaker.mock.calls[0][0]).toMatchObject({
      id: "ayase",
      ref_url: "/references/ayase.wav",
    });
    // refresh must not select/swap the row (stopPropagation) — active stays natsume
    expect(swapSpeaker).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    await flush();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("on a rejected refreshSpeaker the row gets the error state", async () => {
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {
      throw new Error("update failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Rena
    await flush();

    const errorRow = qc.el.querySelector<HTMLElement>(".yui-spk.is-error")!;
    expect(errorRow).not.toBeNull();
    expect(errorRow.querySelector(".yui-spk__name")!.textContent).toBe("Rena");
    expect(errorRow.getAttribute("aria-invalid")).toBe("true");
    const errMsg = qc.el.querySelector(".yui-spk__error")!;
    expect(errMsg.textContent).toContain("갱신하지 못했어요");
    // refresh leaves the active selection untouched
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("shows the success note after a resolved refresh, then auto-reverts to idle", async () => {
    vi.useFakeTimers();
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Ayase
    await vi.advanceTimersByTimeAsync(0); // let the refreshSpeaker promise settle

    expect(qc.el.querySelector(".yui-spk__note")).not.toBeNull();
    expect(qc.el.querySelector(".yui-spk__note")!.textContent).toContain("갱신했어요");

    // auto-revert clears the note after the dwell
    await vi.advanceTimersByTimeAsync(2400);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    qc.dispose();
    vi.useRealTimers();
  });

  it("ignores a re-entrant refresh while the same row is already refreshing", async () => {
    let resolveRefresh: (() => void) | null = null;
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(
      () =>
        new Promise<void>((res) => {
          resolveRefresh = res;
        }),
    );
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const refresh = rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    refresh.click();
    // a second click while in-flight must be ignored (button is also disabled, but guard defends)
    const stillRefresh = qc.el
      .querySelectorAll<HTMLElement>(".yui-spk[role=radio]")[1]
      .querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    stillRefresh.click();

    expect(refreshSpeaker).toHaveBeenCalledOnce();

    resolveRefresh?.();
    await flush();

    qc.dispose();
  });

  it("does not render the success note or schedule a dwell timer when disposed mid-refresh", async () => {
    vi.useFakeTimers();
    let resolveRefresh: (() => void) | null = null;
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(
      () =>
        new Promise<void>((res) => {
          resolveRefresh = res;
        }),
    );
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Ayase

    // dispose while the refresh promise is still pending
    qc.dispose();

    // the now-resolving refresh must not write to the torn-down DOM
    resolveRefresh?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    // and no leaked dwell timer fires the note later
    await vi.advanceTimersByTimeAsync(2400);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversation / Session section (window-only)
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — session section", () => {
  let mount: HTMLElement;
  let sessionDiagnostics: ReturnType<typeof createSessionDiagnosticsStore>;
  let sessionStore: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    sessionDiagnostics = createSessionDiagnosticsStore();
    sessionStore = createSessionStore();
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* localStorage 미사용 환경 무시 */
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
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad: createVadSettings(),
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      scheduleSettings: createScheduleSettings(),
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        ],
        defaultUrl: "/vrms/carlotta.vrm",
      }),
      swapVrm: vi.fn(async () => {}),
      speakerSelection: createSpeakerSelection({
        available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
        defaultId: "natsume",
      }),
      swapSpeaker: vi.fn(async () => {}),
      refreshSpeaker: vi.fn(async () => {}),
      sessionDiagnostics,
      sessionStore,
      ...extra,
    });
  }

  it("renders the session section in the window variant", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();
    expect(qc.el.querySelector(".yui-session")).not.toBeNull();
    qc.dispose();
  });

  it("does NOT render the session section in the popover (pet) variant", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();
    expect(qc.el.querySelector(".yui-session")).toBeNull();
    qc.dispose();
  });

  it("renders used/max and percent from the diagnostics store", () => {
    sessionDiagnostics.setUsage(18200, 200000);
    const qc = buildQc({ variant: "window" });
    qc.open();

    const value = qc.el.querySelector<HTMLElement>(".yui-session__value")!;
    expect(value.textContent).toContain("18.2K");
    expect(value.textContent).toContain("200K");
    const pct = qc.el.querySelector<HTMLElement>(".yui-session__value .pct")!;
    expect(pct.textContent).toContain("9%");
    const fill = qc.el.querySelector<HTMLElement>(".yui-meter__fill")!;
    expect(fill.style.width).toBe("9%");

    qc.dispose();
  });

  it("handles a null contextWindow gracefully (no bar, muted readout)", () => {
    sessionDiagnostics.setUsage(18200, null);
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-meter")).toBeNull();
    const value = qc.el.querySelector<HTMLElement>(".yui-session__value")!;
    expect(value.querySelector(".pct")).toBeNull();
    // still shows the used count formatted
    expect(value.textContent).toContain("18.2K");

    qc.dispose();
  });

  it("reset confirm flow clears both the session store and diagnostics", () => {
    sessionStore.set("resp_x"); // populate so clear() actually fires
    sessionDiagnostics.setUsage(50000, 200000);
    const clearSession = vi.spyOn(sessionStore, "clear");
    const clearDiag = vi.spyOn(sessionDiagnostics, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    // the destructive action is gated behind a confirm affordance
    const link = qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!;
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(true);
    link.click();
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(false);

    qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click();
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearDiag).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("reset confirm flow also clears the transcript store when provided", () => {
    const transcript = { get: () => [], append: vi.fn(), clear: vi.fn() };

    const qc = buildQc({ variant: "window", transcript });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click();
    expect(transcript.clear).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("reset confirm flow works when the transcript store is not provided", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    expect(() =>
      qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click(),
    ).not.toThrow();

    qc.dispose();
  });

  it("Cancel dismisses the confirm without clearing", () => {
    sessionStore.set("resp_y");
    const clearSession = vi.spyOn(sessionStore, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    const cancel = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>(".yui-session .yui-pill"),
    ).find((b) => !b.classList.contains("yui-pill--go"))!;
    cancel.click();

    expect(clearSession).not.toHaveBeenCalled();
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(true);

    qc.dispose();
  });

  it("live-updates the readout when the diagnostics store notifies while open", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    sessionDiagnostics.setUsage(100000, 200000);

    const value = qc.el.querySelector<HTMLElement>(".yui-session__value")!;
    expect(value.textContent).toContain("100K");
    expect(qc.el.querySelector<HTMLElement>(".yui-session__value .pct")!.textContent).toContain(
      "50%",
    );

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab layout + VAD silence-window slider
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — tabs + VAD slider", () => {
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
      /* localStorage 미사용 환경 무시 */
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
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad,
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      scheduleSettings: createScheduleSettings(),
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        ],
        defaultUrl: "/vrms/carlotta.vrm",
      }),
      swapVrm: vi.fn(async () => {}),
      speakerSelection: createSpeakerSelection({
        available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
        defaultId: "natsume",
      }),
      swapSpeaker: vi.fn(async () => {}),
      refreshSpeaker: vi.fn(async () => {}),
      ...extra,
    });
  }

  function tabs(qc: ReturnType<typeof createQuickControls>): HTMLButtonElement[] {
    return Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  function panelFor(
    qc: ReturnType<typeof createQuickControls>,
    tab: HTMLButtonElement,
  ): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
  }

  it("renders a tablist with 5 tabs and 5 tabpanels", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const t = tabs(qc);
    expect(t.length).toBe(5);
    expect(qc.el.querySelectorAll('[role="tabpanel"]').length).toBe(5);

    // Each tab is wired to a panel and each panel back to its tab.
    for (const tab of t) {
      const panel = panelFor(qc, tab);
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    qc.dispose();
  });

  it("defaults to the 대화 tab active; its panel visible, others hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const active = t.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(active.textContent).toContain("대화");

    for (const tab of t) {
      const on = tab === active;
      expect(tab.getAttribute("aria-selected")).toBe(String(on));
      expect(tab.tabIndex).toBe(on ? 0 : -1);
      expect(panelFor(qc, tab).hidden).toBe(!on);
    }

    qc.dispose();
  });

  it("clicking a tab switches the active panel + aria-selected/hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const target = t[2]; // 입력
    target.click();

    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, target).hidden).toBe(false);
    for (const tab of t) {
      if (tab === target) continue;
      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(panelFor(qc, tab).hidden).toBe(true);
    }

    qc.dispose();
  });

  it("ArrowRight / ArrowLeft move the active tab (roving tabindex)", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    t[0].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(t[1].getAttribute("aria-selected")).toBe("true");
    expect(t[1].tabIndex).toBe(0);
    expect(t[0].tabIndex).toBe(-1);
    expect(panelFor(qc, t[1]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[0]).hidden).toBe(false);

    qc.dispose();
  });

  it("Home / End jump to the first / last tab", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    t[0].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(t[4].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[4]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[0]).hidden).toBe(false);

    qc.dispose();
  });

  it("keeps exactly one panel visible at all times", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    for (const tab of t) {
      tab.click();
      const visible = t.filter((x) => !panelFor(qc, x).hidden);
      expect(visible.length).toBe(1);
      expect(visible[0]).toBe(tab);
    }

    qc.dispose();
  });

  // ── 침묵 기준 (VAD) 슬라이더 — 입력 탭 ──────────────────────────────────────

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

  // ── 생각중 추임새 (filler) section ──────────────────────────────────────────

  function makeFillerSettings(initial?: { enabled?: boolean; language?: "ja" | "en" | "ko" }) {
    return createFillerSettings({
      initial: { enabled: true, language: "ja", customPools: {}, ...initial },
    });
  }

  it("does not render filler section when fillerSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-filler")).toBeNull();
    qc.dispose();
  });

  it("renders filler section in the talk tab when fillerSettings is provided", () => {
    const fs = makeFillerSettings();
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const section = qc.el.querySelector(".yui-filler");
    expect(section).not.toBeNull();
    // Must be inside the talk panel
    const talkPanel = qc.el.querySelector<HTMLElement>("#yui-panel-talk")!;
    expect(talkPanel.contains(section)).toBe(true);

    qc.dispose();
  });

  it("reflectFiller: enable toggle reflects initial enabled=true", () => {
    const fs = makeFillerSettings({ enabled: true });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    expect(sw).not.toBeNull();
    expect(sw.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("reflectFiller: enable toggle reflects initial enabled=false", () => {
    const fs = makeFillerSettings({ enabled: false });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("clicking the filler switch calls setEnabled with toggled value", () => {
    const fs = makeFillerSettings({ enabled: true });
    const spy = vi.spyOn(fs, "setEnabled");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    sw.click();

    expect(spy).toHaveBeenCalledWith(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("reflectFiller: language seg reflects initial language ja", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[0].getAttribute("aria-checked")).toBe("true"); // ja
    expect(btns[1].getAttribute("aria-checked")).toBe("false"); // en
    expect(btns[2].getAttribute("aria-checked")).toBe("false"); // ko

    qc.dispose();
  });

  it("reflectFiller: language seg reflects initial language en", () => {
    const fs = makeFillerSettings({ language: "en" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en

    qc.dispose();
  });

  it("clicking a language segment calls setLanguage and reloads both textareas", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: {
          ja: { first: ["うーん"], repeat: ["ええと"] },
          en: { first: ["Hmm..."], repeat: ["Still thinking..."] },
        },
      },
    });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // click "en" (index 1)
    btns[1].click();

    expect(spy).toHaveBeenCalledWith("en");
    // both textareas should now show the en custom pool
    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("Hmm...");
    expect(repeat.value).toBe("Still thinking...");

    qc.dispose();
  });

  it("ArrowRight on the filler language seg moves selection, tabindex, and calls setLanguage", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[0].getAttribute("aria-checked")).toBe("true"); // ja
    expect(btns[0].tabIndex).toBe(0);

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(spy).toHaveBeenCalledWith("en");
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
    expect(btns[0].getAttribute("aria-checked")).toBe("false");
    expect(btns[1].tabIndex).toBe(0);
    expect(btns[0].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("Space on a filler language seg button selects that language", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const ko = langSeg.querySelector<HTMLButtonElement>(".yui-seg__btn[data-lang='ko']")!;
    ko.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ko");
    expect(ko.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("editing 첫 대사 calls setCustomPool with split first lines, preserving repeat", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { ja: { first: [], repeat: ["ええと"] } },
      },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    first.value = "うーん\n\nそうだね\n";
    first.dispatchEvent(new Event("input", { bubbles: true }));

    // Empty lines stripped; order preserved; repeat from the other textarea preserved.
    expect(spy).toHaveBeenCalledWith("ja", { first: ["うーん", "そうだね"], repeat: ["ええと"] });

    qc.dispose();
  });

  it("editing 반복 대사 calls setCustomPool with split repeat lines, preserving first", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { ja: { first: ["うーん"], repeat: [] } },
      },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    repeat.value = "ええと\n\nもう少し\n";
    repeat.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", { first: ["うーん"], repeat: ["ええと", "もう少し"] });

    qc.dispose();
  });

  it("clearing both textareas calls setCustomPool with empty lists", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    first.value = "";
    first.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", { first: [], repeat: [] });

    qc.dispose();
  });

  it("reflectFiller syncs both textareas from customPools for current language on open", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ko",
        customPools: { ko: { first: ["음…", "글쎄…"], repeat: ["아직…"] } },
      },
    });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("음…\n글쎄…");
    expect(repeat.value).toBe("아직…");

    qc.dispose();
  });

  it("reflectFiller: both textareas are empty when customPools has no entry for the current language", () => {
    const fs = makeFillerSettings({ language: "en" }); // no customPools for en
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("");
    expect(repeat.value).toBe("");

    qc.dispose();
  });

  it("external fillerSettings store change reflects in the UI while open", () => {
    const fs = makeFillerSettings({ enabled: true, language: "ja" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    fs.setEnabled(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings rail — collapsible two-column layout (talk/character/input/adv/react)
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — sections rail collapse", () => {
  const RAIL_COLLAPSED_KEY = "yui.quickControls.railCollapsed";
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
      /* localStorage 미사용 환경 무시 */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad: createVadSettings(),
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      scheduleSettings: createScheduleSettings(),
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        ],
        defaultUrl: "/vrms/carlotta.vrm",
      }),
      swapVrm: vi.fn(async () => {}),
      importVrm: vi.fn(async () => {}),
      removeUserVrm: vi.fn(async () => {}),
      speakerSelection: createSpeakerSelection({
        available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
        defaultId: "natsume",
      }),
      swapSpeaker: vi.fn(async () => {}),
      refreshSpeaker: vi.fn(async () => {}),
      importVoice: vi.fn(async () => {}),
      removeUserVoice: vi.fn(async () => {}),
      ...extra,
    });
  }

  it("renders expanded by default: aria-expanded=true, no is-rail-collapsed class", () => {
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(collapseBtn).not.toBeNull();
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
    expect(cols.classList.contains("is-rail-collapsed")).toBe(false);

    qc.dispose();
  });

  it("clicking the collapse button toggles is-rail-collapsed + aria-expanded, and persists to localStorage", () => {
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;

    collapseBtn.click();
    expect(cols.classList.contains("is-rail-collapsed")).toBe(true);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("false");
    expect(globalThis.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe("true");

    collapseBtn.click();
    expect(cols.classList.contains("is-rail-collapsed")).toBe(false);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
    expect(globalThis.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe("false");

    qc.dispose();
  });

  it("reads the persisted collapsed state on build, applied before first paint", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, "true");
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(cols.classList.contains("is-rail-collapsed")).toBe(true);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("false");

    qc.dispose();
  });

  it("tabs stay clickable and switch panels while the rail is collapsed", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, "true");
    const qc = buildQc();
    qc.open();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const target = tabs[2];
    target.click();

    expect(target.getAttribute("aria-selected")).toBe("true");
    const panel = qc.el.querySelector<HTMLElement>(`#${target.getAttribute("aria-controls")}`)!;
    expect(panel.hidden).toBe(false);
    for (const tab of tabs) {
      if (tab === target) continue;
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }

    qc.dispose();
  });

  it("the indicator still tracks the active tab (--tab custom property) while collapsed", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, "true");
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs[3].click();

    expect(tablist.style.getPropertyValue("--tab")).toBe("3");

    qc.dispose();
  });

  it("every tab keeps an accessible name (title + aria-label) for the icon-only collapsed state", () => {
    const qc = buildQc();
    qc.open();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab.getAttribute("aria-label")).toBeTruthy();
      expect(tab.getAttribute("title")).toBeTruthy();
    }

    qc.dispose();
  });

  it("guards localStorage access — a throwing localStorage does not break construction or the toggle", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(() => {
      const qc = buildQc();
      qc.open();
      const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
      collapseBtn.click();
      qc.dispose();
    }).not.toThrow();

    if (original) Object.defineProperty(globalThis, "localStorage", original);
  });

  // ── a11y: the collapse button must not be an owned child of role=tablist ──

  it("the collapse button lives outside [role=tablist] (ARIA tablist owns only tabs)", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(tablist).not.toBeNull();
    expect(tablist.querySelector(".yui-rail-collapse")).toBeNull();

    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(collapseBtn).not.toBeNull();
    expect(tablist.contains(collapseBtn)).toBe(false);

    qc.dispose();
  });

  it("ArrowDown/ArrowRight pressed while the collapse button is focused does not change the selected tab", () => {
    const qc = buildQc();
    qc.open();

    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const activeBefore = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;

    collapseBtn.focus();
    collapseBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    collapseBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    const activeAfter = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(activeAfter).toBe(activeBefore);

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Language picker (i18n)
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — language picker", () => {
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
      /* localStorage 미사용 환경 무시 */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad: createVadSettings(),
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      scheduleSettings: createScheduleSettings(),
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        ],
        defaultUrl: "/vrms/carlotta.vrm",
      }),
      swapVrm: vi.fn(async () => {}),
      speakerSelection: createSpeakerSelection({
        available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
        defaultId: "natsume",
      }),
      swapSpeaker: vi.fn(async () => {}),
      refreshSpeaker: vi.fn(async () => {}),
      ...extra,
    });
  }

  it("renders a 3-way language segmented control with display names", () => {
    const qc = buildQc();
    qc.open();
    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    expect(seg).not.toBeNull();
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    const locales = btns.map((b) => b.dataset.locale);
    expect(locales).toEqual(["ja", "en", "ko"]);
    const labels = btns.map((b) => b.textContent);
    expect(labels).toEqual([
      LOCALE_DISPLAY_NAMES.ja,
      LOCALE_DISPLAY_NAMES.en,
      LOCALE_DISPLAY_NAMES.ko,
    ]);
    qc.dispose();
  });

  it("reflects the current locale as the checked segment on render", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    const checked = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[aria-checked='true']",
    )!;
    expect(checked.dataset.locale).toBe("ko");
    qc.dispose();
  });

  it("clicking a language segment calls setLocale with that locale", () => {
    const qc = buildQc();
    qc.open();
    expect(getLocale()).toBe("en");
    const koBtn = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[data-locale='ko']",
    )!;
    koBtn.click();
    expect(getLocale()).toBe("ko");
    qc.dispose();
  });

  it("renders panel text via t() in the active locale", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    // The reasoning-effort field label is keyed; ko renders the Korean copy.
    const label = qc.el.querySelector<HTMLElement>(".yui-field-row__label")!;
    expect(label.textContent).toBe("추론 강도");
    qc.dispose();
  });

  it("arrow keys on the language seg move roving focus only — locale is NOT committed", () => {
    setLocale("en"); // en = index 1
    const qc = buildQc();
    qc.open();

    // 화살표가 setLocale을 부르는지 감시(구독은 setLocale마다 통지).
    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
    btns[1].focus();

    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // 커밋 없음: locale·aria-checked 그대로, 포커스·roving tabindex만 ko로 이동.
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[2].getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(btns[2]);
    expect(btns[2].tabIndex).toBe(0);
    expect(btns[1].tabIndex).toBe(-1);

    // ArrowLeft로 다시 en 버튼에 포커스만 이동(여전히 커밋 없음).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(document.activeElement).toBe(btns[1]);
    expect(btns[1].tabIndex).toBe(0);

    unsub();
    qc.dispose();
  });

  it("Space on the focused locale button commits setLocale exactly once", () => {
    setLocale("en");
    const qc = buildQc();
    qc.open();

    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // 화살표로 ko에 포커스만 옮긴다(커밋 없음).
    btns[1].focus();
    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");

    // 포커스된 버튼에서 Space → 커밋(정확히 1회).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(commits).toBe(1);
    expect(getLocale()).toBe("ko");
    expect(btns[2].getAttribute("aria-checked")).toBe("true");
    expect(btns[1].getAttribute("aria-checked")).toBe("false");

    unsub();
    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reactions tab — new 5th tab + panel with loop cue, watchers, and shared rows
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — Reactions tab", () => {
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
      /* localStorage 미사용 환경 무시 */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      idleThrottleSettings: createIdleThrottleSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad: createVadSettings(),
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      scheduleSettings: createScheduleSettings(),
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      onPopOut: vi.fn(),
      vrmSelection: makeVrmSelection(),
      swapVrm: vi.fn(async () => {}),
      importVrm: vi.fn(async () => {}),
      removeUserVrm: vi.fn(async () => {}),
      speakerSelection: makeSpeakerSelection(),
      swapSpeaker: vi.fn(async () => {}),
      refreshSpeaker: vi.fn(async () => {}),
      importVoice: vi.fn(async () => {}),
      removeUserVoice: vi.fn(async () => {}),
      ...extra,
    });
  }

  it("renders the Reactions tab button (#yui-tab-react)", () => {
    const qc = buildQc();
    qc.open();
    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react");
    expect(tab).not.toBeNull();
    expect(tab!.getAttribute("role")).toBe("tab");
    expect(tab!.getAttribute("aria-controls")).toBe("yui-panel-react");
    expect(tab!.textContent?.trim()).toBe("Reactions");
    qc.dispose();
  });

  it("renders #yui-panel-react as a tabpanel, hidden by default", () => {
    const qc = buildQc();
    qc.open();
    const panel = qc.el.querySelector<HTMLElement>("#yui-panel-react");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("tabpanel");
    expect(panel!.getAttribute("aria-labelledby")).toBe("yui-tab-react");
    expect(panel!.hidden).toBe(true);
    qc.dispose();
  });

  it("mounts proactiveCueList into .yui-loop-cue-section inside #yui-panel-react", () => {
    const qc = buildQc();
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const loopSection = reactPanel.querySelector(".yui-loop-cue-section");
    expect(loopSection).not.toBeNull();
    expect(loopSection!.querySelector("[data-testid='cue-section']")).not.toBeNull();
    qc.dispose();
  });

  it("schedule cue list stays in #yui-panel-input (.yui-cue-sections), not in react panel", () => {
    const qc = buildQc();
    qc.open();
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const cueSectionsInInput = inputPanel.querySelector(".yui-cue-sections");
    expect(cueSectionsInInput).not.toBeNull();
    expect(cueSectionsInInput!.querySelector("[data-testid='cue-section']")).not.toBeNull();
    // loop-cue-section must not be inside input panel
    expect(inputPanel.querySelector(".yui-loop-cue-section")).toBeNull();
    // cue-sections must not be inside react panel
    expect(reactPanel.querySelector(".yui-cue-sections")).toBeNull();
    qc.dispose();
  });

  it("github switch lives inside #yui-panel-react, not #yui-panel-adv", () => {
    const qc = buildQc({ githubSettings: createGithubSettings() });
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const advPanel = qc.el.querySelector<HTMLElement>("#yui-panel-adv")!;
    const githubSwitch = qc.el.querySelector(".yui-github-switch");
    expect(githubSwitch).not.toBeNull();
    expect(reactPanel.contains(githubSwitch)).toBe(true);
    expect(advPanel.contains(githubSwitch)).toBe(false);
    qc.dispose();
  });

  it("agentNotify switch lives inside #yui-panel-react, not #yui-panel-adv", () => {
    const qc = buildQc({ agentNotifySettings: createAgentNotifySettings() });
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const advPanel = qc.el.querySelector<HTMLElement>("#yui-panel-adv")!;
    const agentNotifySwitch = qc.el.querySelector(".yui-agentnotify-switch");
    expect(agentNotifySwitch).not.toBeNull();
    expect(reactPanel.contains(agentNotifySwitch)).toBe(true);
    expect(advPanel.contains(agentNotifySwitch)).toBe(false);
    qc.dispose();
  });

  it("renders #yui-github-poll that reflects githubSettings.poll_interval_ms/1000 on open", () => {
    const githubSettings = createGithubSettings();
    const qc = buildQc({ githubSettings });
    qc.open();
    const pollInput = qc.el.querySelector<HTMLInputElement>("#yui-github-poll");
    expect(pollInput).not.toBeNull();
    // Default poll_interval_ms = 60000 → 60 s
    expect(pollInput!.value).toBe("60");
    qc.dispose();
  });

  it("change on #yui-github-poll calls githubSettings.setPollInterval(s * 1000)", () => {
    const githubSettings = createGithubSettings();
    const setSpy = vi.spyOn(githubSettings, "setPollInterval");
    const qc = buildQc({ githubSettings });
    qc.open();
    const pollInput = qc.el.querySelector<HTMLInputElement>("#yui-github-poll")!;
    pollInput.value = "120";
    pollInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(120000);
    qc.dispose();
  });

  it("after a valid poll change the input value snaps to stored value via re-reflect", () => {
    const githubSettings = createGithubSettings();
    const qc = buildQc({ githubSettings });
    qc.open();
    const pollInput = qc.el.querySelector<HTMLInputElement>("#yui-github-poll")!;
    pollInput.value = "30";
    pollInput.dispatchEvent(new Event("change", { bubbles: true }));
    // store floor is 10 s (10000 ms) — 30 is valid, stored as 30000 ms
    expect(githubSettings.get().poll_interval_ms).toBe(30000);
    // input reflects stored value (30 s)
    expect(pollInput.value).toBe("30");
    qc.dispose();
  });

  it("renders #yui-agent-port that reflects agentNotifySettings.port on open", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port");
    expect(portInput).not.toBeNull();
    // Default port = 8770
    expect(portInput!.value).toBe("8770");
    qc.dispose();
  });

  it("change on #yui-agent-port calls agentNotifySettings.setPort", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "9000";
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(9000);
    qc.dispose();
  });

  it("does not render #yui-presence when presenceSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-presence")).toBeNull();
    qc.dispose();
  });

  it("renders #yui-presence inside #yui-panel-react when presenceSettings is provided", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence");
    expect(presenceInput).not.toBeNull();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    expect(reactPanel.contains(presenceInput)).toBe(true);
    qc.dispose();
  });

  it("#yui-presence reflects presenceSettings.present_max_idle_ms/1000 on open", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    // Default present_max_idle_ms = 180000 → 180 s
    expect(presenceInput.value).toBe("180");
    qc.dispose();
  });

  it("change on #yui-presence calls presenceSettings.setPresentMaxIdleMs(s * 1000)", () => {
    const presenceSettings = createPresenceSettings();
    const setSpy = vi.spyOn(presenceSettings, "setPresentMaxIdleMs");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "300";
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(300000);
    qc.dispose();
  });

  it("external presenceSettings.setPresentMaxIdleMs reflects into #yui-presence while open", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceSettings.setPresentMaxIdleMs(60000);
    expect(presenceInput.value).toBe("60");
    qc.dispose();
  });

  // ── Snap-back regression tests ────────────────────────────────────────────
  // When the store setter silently rejects an out-of-range value (no-op),
  // the change handler's explicit reflect.*() must snap the input back to the
  // current stored value so the field never shows an uncommitted state.

  it("below-floor value in #yui-github-poll snaps back: store unchanged, input reverts to 60", () => {
    const githubSettings = createGithubSettings(); // default poll_interval_ms = 60000
    const setSpy = vi.spyOn(githubSettings, "setPollInterval");
    const qc = buildQc({ githubSettings });
    qc.open();
    const pollInput = qc.el.querySelector<HTMLInputElement>("#yui-github-poll")!;
    pollInput.value = "5"; // 5 s → 5000 ms — below the 10 000 ms floor
    pollInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(5000); // setter was invoked but rejected
    expect(githubSettings.get().poll_interval_ms).toBe(60000); // store unchanged
    expect(pollInput.value).toBe("60"); // input snapped back
    qc.dispose();
  });

  it("below-range value in #yui-agent-port snaps back: store unchanged, input reverts to 8770", () => {
    const agentNotifySettings = createAgentNotifySettings(); // default port = 8770
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "80"; // below the 1024 minimum
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(80); // setter was invoked but rejected
    expect(agentNotifySettings.get().port).toBe(8770); // store unchanged
    expect(portInput.value).toBe("8770"); // input snapped back
    qc.dispose();
  });

  it("below-floor value in #yui-presence snaps back: store unchanged, input reverts to 180", () => {
    const presenceSettings = createPresenceSettings(); // default present_max_idle_ms = 180000
    const setSpy = vi.spyOn(presenceSettings, "setPresentMaxIdleMs");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "5"; // 5 s → 5000 ms — below the 10 000 ms floor
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(5000); // setter was invoked but rejected
    expect(presenceSettings.get().present_max_idle_ms).toBe(180000); // store unchanged
    expect(presenceInput.value).toBe("180"); // input snapped back
    qc.dispose();
  });
});
