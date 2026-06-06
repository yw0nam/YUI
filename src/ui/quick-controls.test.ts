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
import { createQuickControls } from "./quick-controls";
import { createLipsyncSettings } from "../io/lipsync-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal stubs for existing required options
// ─────────────────────────────────────────────────────────────────────────────

function makeSettings() {
  return {
    get: () => ({ enabled: false, source: { kind: "monitor" as const, index: 0 } }),
    setEnabled: vi.fn(),
    setSource: vi.fn(),
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

describe("createQuickControls — gain row", () => {
  let mount: HTMLElement;
  let onGainPreview: ReturnType<typeof vi.fn>;
  let onGainPreviewEnd: ReturnType<typeof vi.fn>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;

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
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc() {
    return createQuickControls({
      mount,
      settings: makeSettings(),
      sourceProvider: makeSourceProvider(),
      voiceStatus: makeVoiceStatus(),
      lipsync,
      onGainPreview,
      onGainPreviewEnd,
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

    // preview formula: clamp(gain * PREVIEW_PEAK_RMS, 0, 1) = clamp(3 * 0.15, 0, 1) = 0.45
    expect(onGainPreview).toHaveBeenCalledOnce();
    expect(onGainPreview.mock.calls[0][0]).toBeCloseTo(0.45);

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
});
