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

// Build a real createSpeakerSelection over an explicit manifest (default first id).
function makeSpeakerSelection(ids: string[] = ["natsume", "ayase", "rena"]) {
  const available: SpeakerOption[] = ids.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    ref_url: `/references/${id}.wav`,
  }));
  return createSpeakerSelection({ available, defaultId: available[0].id });
}

describe("createQuickControls — gain row", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let onPopOut: Mock<() => void>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;

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
    onPopOut = vi.fn<() => void>();
    vrmSelection = makeVrmSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async (option) => {
      vrmSelection.select(option.id);
    });
    speakerSelection = makeSpeakerSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    // refresh is server-side only — default fake resolves without touching the store.
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {});
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
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      onPopOut,
      vrmSelection,
      swapVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      ...extra,
    });
  }

  // ── Slider exists with correct attributes ─────────────────────────────────

  it("renders a range slider with min=0.5, max=4, value=2 (default gain)", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>("input.yui-gain__slider[type=range]");
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("0.5");
    expect(slider!.max).toBe("4");
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

  it("renders 5 endpoint fields (4 url + chat_model) in a collapsed details", () => {
    const qc = buildQc();
    qc.open();

    const details = qc.el.querySelector<HTMLDetailsElement>("details.yui-endpoints")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false); // 기본 접힘
    const keys = Array.from(qc.el.querySelectorAll<HTMLDivElement>(".yui-endpoints .yui-input-row")).map(
      (r) => r.dataset.epField,
    );
    expect(keys).toEqual(["chat_base_url", "stt_base_url", "tts_base_url", "irodori_base_url", "chat_model"]);
    expect(qc.el.querySelectorAll(".yui-endpoints .yui-ep-input--url").length).toBe(4);

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

  it("the '파일에서 추가…' row is disabled and not interactive", () => {
    const qc = buildQc();
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.tabIndex).toBe(-1);
    // it is NOT a radio (excluded from the radiogroup roving order)
    expect(add.getAttribute("role")).not.toBe("radio");

    add.click();
    expect(swapVrm).not.toHaveBeenCalled();

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

  it("the speaker '파일에서 추가…' row is disabled and not a radio", () => {
    const qc = buildQc();
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.tabIndex).toBe(-1);
    expect(add.getAttribute("role")).not.toBe("radio");

    add.click();
    expect(swapSpeaker).not.toHaveBeenCalled();

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
