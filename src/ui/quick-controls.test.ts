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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQuickControls, PREVIEW_PEAK_RMS } from "./quick-controls";
import { createLipsyncSettings } from "../io/lipsync-settings";
import { createVrmSelection } from "../io/vrm-selection";
import type { AvatarOption } from "../config/load";
import {
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
  type AgentSettings,
  type AgentStorage,
} from "../io/agent-settings";

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

describe("createQuickControls — gain row", () => {
  let mount: HTMLElement;
  let onGainPreview: ReturnType<typeof vi.fn>;
  let onGainPreviewEnd: ReturnType<typeof vi.fn>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let onPopOut: ReturnType<typeof vi.fn>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: ReturnType<typeof vi.fn>;

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

    onGainPreview = vi.fn();
    onGainPreviewEnd = vi.fn();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    onPopOut = vi.fn();
    vrmSelection = makeVrmSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapVrm = vi.fn(async (option: AvatarOption) => {
      vrmSelection.select(option.id);
    });
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
      onPopOut,
      vrmSelection,
      swapVrm,
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
    swapVrm = vi.fn(async () => {
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

  it("ArrowDown on the VRM radiogroup moves selection to the next row and swaps", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    // active is row 0 (Carlotta); ArrowDown → row 1 (Aria)
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "aria" });

    qc.dispose();
  });

  it("End key on the VRM radiogroup swaps to the last row", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "mirai" });

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
});
