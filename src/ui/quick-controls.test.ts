// @vitest-environment jsdom
/**
 * quick-controls.test.ts — TDD red for the lipsync gain row in the quick-settings popover.
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

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { createQuickControls, PREVIEW_PEAK_RMS } from "./quick-controls";
import { createLipsyncSettings } from "../io/lipsync-settings";
import { createVadSettings, VAD_SILENCE_DEFAULT } from "../io/vad-settings";
import { createVrmSelection } from "../io/vrm-selection";
import { createSpeakerSelection, type SpeakerOption } from "../io/speaker-selection";
import type { AvatarOption } from "../config/load";
import {
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
  type AgentSettings,
  type AgentStorage,
} from "../io/agent-settings";
import { createEndpointsSettings } from "../io/endpoints-settings";
import { createProactiveSettings } from "../io/proactive-settings";
import { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import { createSessionStore } from "../io/session-store";
import { createChatKeySettings } from "../io/chat-key-settings";

// jsdom 29 lacks CSS.escape (browsers have it) — polyfill so selector-escaping paths run.
// Escapes ASCII chars that aren't safe identifier chars; non-ASCII passes through (safe unescaped).
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
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
    get: () => ({ state: "idle" as const, label: "Idle", detail: "Voice input is off", visible: false }),
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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync,
      vad: createVadSettings(),
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      chatKeySettings: createChatKeySettings(),
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

  // ── Proactive toggle row (#24 Step 9) ─────────────────────────────────────

  it("renders the proactive toggle row above the screenshot row, ON by default", () => {
    const qc = buildQc();
    qc.open();

    const proactiveSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-proactive-switch");
    expect(proactiveSwitch).not.toBeNull();
    // Default ON reflects on open.
    expect(proactiveSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(proactiveSwitch!.getAttribute("role")).toBe("switch");
    expect(proactiveSwitch!.getAttribute("aria-label")).toBe("주도적 반응");

    // Row carries the approved label + sub-label.
    const row = proactiveSwitch!.closest(".yui-row")!;
    expect(row.querySelector(".yui-row__label")!.textContent).toContain("주도적 반응");
    expect(row.querySelector(".yui-row__sub")!.textContent).toContain(
      "다른 앱을 쓸 때도 가끔 먼저 말을 걸어요",
    );

    // Ordered directly above the screenshot row in the same body.
    const switches = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-switch"));
    const proactiveIdx = switches.indexOf(proactiveSwitch!);
    const screenshotSwitch = qc.el.querySelector<HTMLButtonElement>(
      ".yui-switch[aria-label='스크린샷 첨부']",
    )!;
    const screenshotIdx = switches.indexOf(screenshotSwitch);
    expect(proactiveIdx).toBeGreaterThanOrEqual(0);
    expect(proactiveIdx).toBeLessThan(screenshotIdx);

    qc.dispose();
  });

  it("clicking the proactive switch toggles proactiveSettings.setEnabled", () => {
    const qc = buildQc();
    qc.open();

    const proactiveSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-proactive-switch")!;
    expect(proactiveSettings.get().enabled).toBe(true);

    proactiveSwitch.click();
    expect(proactiveSettings.get().enabled).toBe(false);
    expect(proactiveSwitch.getAttribute("aria-checked")).toBe("false");

    proactiveSwitch.click();
    expect(proactiveSettings.get().enabled).toBe(true);
    expect(proactiveSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("external proactiveSettings.setEnabled reflects on the switch while open", () => {
    const qc = buildQc();
    qc.open();

    const proactiveSwitch = qc.el.querySelector<HTMLButtonElement>(".yui-proactive-switch")!;
    proactiveSettings.setEnabled(false);
    expect(proactiveSwitch.getAttribute("aria-checked")).toBe("false");

    proactiveSettings.setEnabled(true);
    expect(proactiveSwitch.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  // ── Slider exists with correct attributes ─────────────────────────────────

  it("renders a range slider with min=0.5, max=6, value=2 (default gain)", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider:not(.yui-vad__slider)[type=range]");
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
    // order: default · low · medium · high
    expect(btns).toHaveLength(4);
    const medium = btns[2];

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
    // start at default (index 0)
    expect(btns[0].getAttribute("aria-checked")).toBe("true");

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(agentSettings.get().reasoning_effort).toBe("low");
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

  it("uses getDefaultInstructions() as the textarea placeholder when provided", () => {
    const qc = buildQc({ getDefaultInstructions: () => "default nudge here" });
    qc.open();

    const ta = qc.el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
    expect(ta.placeholder).toBe("default nudge here");

    qc.dispose();
  });

  // ── 엔드포인트 섹션(#95) ───────────────────────────────────────────────────

  it("renders 6 endpoint fields (5 url + chat_model) in a collapsed details", () => {
    const qc = buildQc();
    qc.open();

    const details = qc.el.querySelector<HTMLDetailsElement>("details.yui-endpoints")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false); // 기본 접힘
    const keys = Array.from(qc.el.querySelectorAll<HTMLDivElement>(".yui-endpoints .yui-input-row")).map(
      (r) => r.dataset.epField,
    );
    expect(keys).toEqual([
      "chat_base_url",
      "stt_base_url",
      "tts_base_url",
      "irodori_base_url",
      "broker_base_url",
      "chat_model",
    ]);
    expect(qc.el.querySelectorAll(".yui-endpoints .yui-ep-input--url").length).toBe(5);

    qc.dispose();
  });

  it("populates endpoint placeholders from getEndpointDefaults() on open even when defaults arrive after construction", () => {
    // 패널은 config 로드 전에 생성된다 — 생성 시점엔 defaults가 없고 open() 시점에 채워져야 한다(회귀: #95).
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
      qc.el.querySelector<HTMLInputElement>(`.yui-input-row[data-ep-field="${key}"] .yui-ep-input`)!.placeholder;
    expect(ph("chat_base_url")).toBe("http://localhost:8643/v1");
    expect(ph("stt_base_url")).toBe("http://localhost:5517/v1");
    expect(ph("chat_model")).toBe("natsume");

    qc.dispose();
  });

  it("toggles inline invalid state on a url field via isValidEndpointUrl (empty = no error)", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>('.yui-input-row[data-ep-field="stt_base_url"] .yui-ep-input')!;
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

  it("persists an endpoint override into the store and reset() clears it", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>('.yui-input-row[data-ep-field="chat_base_url"] .yui-ep-input')!;
    input.value = "https://api.example.com/v1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().chat_base_url).toBe("https://api.example.com/v1");

    qc.el.querySelector<HTMLButtonElement>(".yui-ep-reset")!.click();
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });

  // ── chat API key field (#150) ─────────────────────────────────────────────

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
    const sub = input.closest<HTMLDivElement>(".yui-input-row")!.querySelector<HTMLElement>(".yui-input-row__sub")!;
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

  // ── voice engine (tts_provider) toggle + broker URL row (#136) ─────────────

  function voiceSegButtons(qc: { el: HTMLElement }): HTMLButtonElement[] {
    const seg = qc.el.querySelector<HTMLDivElement>(".yui-seg--2")!;
    return Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  }

  it("renders a 2-segment voice-engine control in the character panel", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const seg = qc.el.querySelector<HTMLDivElement>(".yui-seg--2");
    expect(seg).not.toBeNull();
    expect(seg!.getAttribute("role")).toBe("radiogroup");
    // Lives inside the character tab panel, alongside the speaker list.
    const charPanel = qc.el.querySelector<HTMLElement>("#yui-panel-char")!;
    expect(charPanel.contains(seg!)).toBe(true);
    expect(charPanel.querySelector(".yui-spk-scroll")).not.toBeNull();

    const btns = voiceSegButtons(qc);
    expect(btns.map((b) => b.dataset.provider)).toEqual(["irodori", "openai"]);
    expect(btns[1].textContent).toContain("OpenAI");

    qc.dispose();
  });

  it("reflects the effective provider: bundled default when no override", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();
    const btns = voiceSegButtons(qc);
    expect(btns[0].getAttribute("aria-checked")).toBe("false"); // irodori
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // openai
    qc.dispose();
  });

  it("reflects the effective provider: override wins over the default", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();
    const btns = voiceSegButtons(qc);
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // openai override
    qc.dispose();
  });

  it("clicking 'OpenAI' persists the override and disables the speaker list with a hint", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const btns = voiceSegButtons(qc);
    btns[1].click(); // openai
    expect(endpointsSettings.get().tts_provider).toBe("openai");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");

    const charPanel = qc.el.querySelector<HTMLElement>("#yui-panel-char")!;
    expect(charPanel.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(true);
    expect(charPanel.querySelector(".yui-spk-foot")!.classList.contains("is-disabled")).toBe(true);
    const hint = charPanel.querySelector<HTMLElement>(".yui-spks-hint")!;
    expect(hint).not.toBeNull();
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("irodori 전용");

    qc.dispose();
  });

  it("the voice-engine sub-label reads the approved copy", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const seg = qc.el.querySelector<HTMLDivElement>(".yui-seg--2")!;
    const sub = seg.closest(".yui-field-row")!.querySelector(".yui-field-row__sub")!;
    expect(sub.textContent).toBe("캐릭터 목소리를 만드는 합성 엔진");

    qc.dispose();
  });

  it("places the OpenAI speaker hint ABOVE the speaker list, under the voice-engine seg", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const seg = qc.el.querySelector(".yui-seg--2")!;
    const hint = qc.el.querySelector(".yui-spks-hint")!;
    const list = qc.el.querySelector(".yui-spk-scroll")!;
    // seg → hint → list in document order
    expect(seg.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    qc.dispose();
  });

  it("clicking 'irodori' re-enables the speaker list and hides the hint", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const btns = voiceSegButtons(qc);
    btns[0].click(); // irodori
    expect(endpointsSettings.get().tts_provider).toBe("irodori");

    const charPanel = qc.el.querySelector<HTMLElement>("#yui-panel-char")!;
    expect(charPanel.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(false);
    expect(charPanel.querySelector<HTMLElement>(".yui-spks-hint")!.hidden).toBe(true);

    qc.dispose();
  });

  it("renders a broker_base_url endpoint row that persists and clears on reset", () => {
    const qc = buildQc();
    qc.open();

    const row = qc.el.querySelector<HTMLDivElement>('.yui-input-row[data-ep-field="broker_base_url"]');
    expect(row).not.toBeNull();
    const input = row!.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input.classList.contains("yui-ep-input--url")).toBe(true);

    input.value = "http://localhost:3201/mcp";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().broker_base_url).toBe("http://localhost:3201/mcp");

    qc.el.querySelector<HTMLButtonElement>(".yui-ep-reset")!.click();
    expect(endpointsSettings.get().broker_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });

  // ── reflect store state on open ───────────────────────────────────────────

  it("open() reflects the store's reasoning_effort and instructions", () => {
    agentSettings.setReasoningEffort("high");
    agentSettings.setInstructions("hello world");

    const qc = buildQc();
    qc.open();

    const btns = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[3].getAttribute("aria-checked")).toBe("true"); // high
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
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // low

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

    const closeBtn = qc.el.querySelector<HTMLButtonElement>(".yui-quick__bar-actions .yui-iconbtn:not(.yui-iconbtn--popout)")!;
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
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 170, clientY: 160 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 170, clientY: 160 }));

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

  // ── VRM section (#94 P3) ────────────────────────────────────────────────────

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
    const evil = 'a<img src=x onerror=alert(1)>b';
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

  // ── BYO-VRM: user rows + import + rename + remove (#147) ─────────────────────

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
    expect(vrmGroup.compareDocumentPosition(spkGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "ayase", ref_url: "/references/ayase.wav" });

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

  // ── 화자: user (imported) voice management — mirrors the VRM section (#148) ──

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

  it("routes the audition url through the asset resolver before constructing Audio (#153)", async () => {
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
    const evil = 'a<img src=x onerror=alert(1)>b';
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

  // ── 화자 행 참조-음성 갱신(refresh) 버튼 — issue #103 ──────────────────────

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
      expect(refresh!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(refreshSpeaker.mock.calls[0][0]).toMatchObject({ id: "ayase", ref_url: "/references/ayase.wav" });
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
      () => new Promise<void>((res) => { resolveRefresh = res; }),
    );
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const refresh = rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    refresh.click();
    // a second click while in-flight must be ignored (button is also disabled, but guard defends)
    const stillRefresh = qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]")[1]
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
      () => new Promise<void>((res) => { resolveRefresh = res; }),
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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad: createVadSettings(),
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      chatKeySettings: createChatKeySettings(),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [{ id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" }],
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

  it("shows a muted placeholder when there is no last compression", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-session__empty")).not.toBeNull();
    expect(qc.el.querySelector(".yui-session__grid .v")).toBeNull();

    qc.dispose();
  });

  it("renders a formatted last-compression line when present", () => {
    sessionDiagnostics.setLastCompression({
      beforeTokens: 120000,
      afterTokens: 18000,
      removed: 34,
      at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    });
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-session__empty")).toBeNull();
    const v = qc.el.querySelector<HTMLElement>(".yui-session__grid .v")!;
    expect(v.textContent).toContain("120K");
    expect(v.textContent).toContain("18K");
    expect(v.textContent).toContain("34");

    qc.dispose();
  });

  it("reset confirm flow clears both the session store and diagnostics", () => {
    sessionStore.get(); // mint an id so clear() actually fires
    sessionDiagnostics.setUsage(50000, 200000);
    const clearSession = vi.spyOn(sessionStore, "clear");
    const clearDiag = vi.spyOn(sessionDiagnostics, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    // the destructive action is gated behind a confirm affordance
    const link = qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!;
    expect(qc.el.querySelector<HTMLElement>(".yui-confirm")!.hidden).toBe(true);
    link.click();
    expect(qc.el.querySelector<HTMLElement>(".yui-confirm")!.hidden).toBe(false);

    qc.el.querySelector<HTMLButtonElement>(".yui-pill--go")!.click();
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearDiag).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("Cancel dismisses the confirm without clearing", () => {
    sessionStore.get();
    const clearSession = vi.spyOn(sessionStore, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    const cancel = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-pill")).find(
      (b) => !b.classList.contains("yui-pill--go"),
    )!;
    cancel.click();

    expect(clearSession).not.toHaveBeenCalled();
    expect(qc.el.querySelector<HTMLElement>(".yui-confirm")!.hidden).toBe(true);

    qc.dispose();
  });

  it("live-updates the readout when the diagnostics store notifies while open", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    sessionDiagnostics.setUsage(100000, 200000);

    const value = qc.el.querySelector<HTMLElement>(".yui-session__value")!;
    expect(value.textContent).toContain("100K");
    expect(qc.el.querySelector<HTMLElement>(".yui-session__value .pct")!.textContent).toContain("50%");

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab layout (#149) + VAD silence-window slider
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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync: createLipsyncSettings(),
      vad,
      onGainPreview: vi.fn(),
      onGainPreviewEnd: vi.fn(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      endpointsSettings: createEndpointsSettings(),
      proactiveSettings: createProactiveSettings(),
      chatKeySettings: createChatKeySettings(),
      onPopOut: vi.fn(),
      vrmSelection: createVrmSelection({
        available: [{ id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" }],
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

  function panelFor(qc: ReturnType<typeof createQuickControls>, tab: HTMLButtonElement): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
  }

  it("renders a tablist with 4 tabs and 4 tabpanels", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const t = tabs(qc);
    expect(t.length).toBe(4);
    expect(qc.el.querySelectorAll('[role="tabpanel"]').length).toBe(4);

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
    expect(t[3].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[3]).hidden).toBe(false);

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

    const slider = qc.el.querySelector<HTMLInputElement>('.yui-gain__slider[aria-label="침묵 기준"]');
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("500");
    expect(slider!.max).toBe("3000");
    expect(slider!.step).toBe("50");

    qc.dispose();
  });

  it("reflects the vad store value (default 1500 ms) on the readout", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>('.yui-gain__slider[aria-label="침묵 기준"]')!;
    expect(slider.value).toBe(String(VAD_SILENCE_DEFAULT));
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("1500 ms");

    qc.dispose();
  });

  it("dragging the slider calls vad.setSilenceMs and updates the readout", () => {
    const setSpy = vi.spyOn(vad, "setSilenceMs");
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>('.yui-gain__slider[aria-label="침묵 기준"]')!;
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
