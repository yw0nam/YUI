// @vitest-environment jsdom
/**
 * Collapsible Quick Controls sections — native <details class="yui-section" data-section>
 * wrapping every heading-bearing settings group, persisted via sectionsSettings (yui.sections).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExpressMotionSettings } from "../../io/express-motion-settings";
import { createFillerSettings } from "../../io/filler-settings";
import { createGuardrailsSettings } from "../../io/guardrails-settings";
import { createIdleMotionSettings } from "../../io/idle-motion-settings";
import { createFlagSettings } from "../../io/persisted-store";
import { createScreenKnobSettings } from "../../io/screen-settings";
import { createSectionsSettings } from "../../io/sections-settings";
import { createSessionDiagnosticsStore } from "../../io/session-diagnostics";
import { createSessionStore } from "../../io/session-store";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

const IDLE_POOL = {
  vrma_path: "/motions/calm.vrma",
  variants: ["/motions/calm.vrma", "/motions/idle_01.vrma"],
};
const EXPRESS_VOCAB = ["happy", "laugh"];

// jsdom 29 flips a <details>'s `.open` on a native click but — unlike a real browser — does not
// dispatch the follow-up `toggle` event; simulate that second half explicitly.
function clickSummary(details: HTMLDetailsElement): void {
  details.querySelector("summary")!.click();
  details.dispatchEvent(new Event("toggle"));
}

function sectionsOf(root: HTMLElement): HTMLDetailsElement[] {
  return Array.from(root.querySelectorAll<HTMLDetailsElement>("details.yui-section[data-section]"));
}

describe("createQuickControls — collapsible sections", () => {
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
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      sectionsSettings: createSectionsSettings(),
      ...extra,
    });
  }

  // Every optional section wired in, so all 16 ids render for the full-inventory assertion.
  function buildFullQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return buildQc({
      variant: "window",
      fillerSettings: createFillerSettings(),
      idleMotionSettings: createIdleMotionSettings(),
      getIdlePool: () => IDLE_POOL,
      expressMotionSettings: createExpressMotionSettings(),
      getExpressMotions: () => EXPRESS_VOCAB,
      onResetViewpoint: vi.fn(),
      screenSettings: createFlagSettings(false),
      screenKnobSettings: createScreenKnobSettings(),
      rateLimitSettings: createGuardrailsSettings(),
      sessionStore: createSessionStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
      ...extra,
    });
  }

  it("renders every section as details.yui-section[data-section], open by default", () => {
    const qc = buildFullQc();
    qc.open();

    const ids = sectionsOf(qc.el).map((s) => s.dataset.section);
    expect(ids).toEqual([
      "reasoning",
      "language",
      "instructions",
      "filler",
      "vrm",
      "expression",
      "idle-motion",
      "express-motion",
      "viewpoint",
      "screen",
      "reactions-watchers",
      "workflows",
      "reactions-shared",
      "reactions-rate",
      "perf",
      "session",
    ]);
    for (const s of sectionsOf(qc.el)) expect(s.open).toBe(true);

    qc.dispose();
  });

  it("no section is nested inside another section (each toggles independently)", () => {
    const qc = buildFullQc();
    qc.open();

    for (const s of sectionsOf(qc.el)) {
      expect(s.querySelector("details.yui-section")).toBeNull();
    }

    qc.dispose();
  });

  it("a stored closed id renders without `open` on first paint (no flash)", () => {
    const qc = buildQc({
      sectionsSettings: createSectionsSettings({ initial: { closed: ["vrm"] } }),
    });
    qc.open();

    const byId = new Map(sectionsOf(qc.el).map((s) => [s.dataset.section, s]));
    expect(byId.get("vrm")!.open).toBe(false);
    // An untouched section keeps today's always-expanded layout.
    expect(byId.get("reasoning")!.open).toBe(true);

    qc.dispose();
  });

  it("closing a section writes its id to the store", () => {
    const sectionsSettings = createSectionsSettings();
    const qc = buildQc({ sectionsSettings });
    qc.open();

    const vrm = sectionsOf(qc.el).find((s) => s.dataset.section === "vrm")!;
    expect(vrm.open).toBe(true);

    clickSummary(vrm);

    expect(vrm.open).toBe(false);
    expect(sectionsSettings.get().closed).toContain("vrm");

    qc.dispose();
  });

  it("reopening a section removes its id from the store", () => {
    const sectionsSettings = createSectionsSettings({ initial: { closed: ["vrm"] } });
    const qc = buildQc({ sectionsSettings });
    qc.open();

    const vrm = sectionsOf(qc.el).find((s) => s.dataset.section === "vrm")!;
    expect(vrm.open).toBe(false);

    clickSummary(vrm);

    expect(vrm.open).toBe(true);
    expect(sectionsSettings.get().closed).not.toContain("vrm");

    qc.dispose();
  });

  it("a store change from elsewhere (other-window reload) reflects into the DOM", () => {
    const sectionsSettings = createSectionsSettings();
    const qc = buildQc({ sectionsSettings });
    qc.open();

    const vrm = sectionsOf(qc.el).find((s) => s.dataset.section === "vrm")!;
    expect(vrm.open).toBe(true);

    // Simulate another window's edit landing via the store's own subscription (broadcast/reload).
    sectionsSettings.setClosed("vrm", true);

    expect(vrm.open).toBe(false);

    qc.dispose();
  });

  it("a store change made while the panel is closed reflects into the DOM on reopen", () => {
    const sectionsSettings = createSectionsSettings();
    const qc = buildQc({ sectionsSettings });
    qc.open();
    qc.close();

    // Edit lands while closed (subscription is gated on popover.isOpen()) — panel markup is built
    // once, so nothing re-syncs the DOM until the next open() reflect batch runs.
    sectionsSettings.setClosed("vrm", true);

    qc.open();
    const vrm = sectionsOf(qc.el).find((s) => s.dataset.section === "vrm")!;
    expect(vrm.open).toBe(false);

    qc.dispose();
  });
});
