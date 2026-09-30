// @vitest-environment jsdom
/**
 * Settings panel layout — which sections each tab holds, always-open groups (no collapsible
 * sections), segments sized by their options, and the screenshot row's state hint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionDiagnosticsStore } from "../../io/chat/session-diagnostics";
import { createSessionStore } from "../../io/chat/session-store";
import { createExpressMotionSettings } from "../../settings/avatar/express-motion-settings";
import { createIdleMotionSettings } from "../../settings/avatar/idle-motion-settings";
import { createGuardrailsSettings } from "../../settings/backend/guardrails-settings";
import { createScreenKnobSettings } from "../../settings/capture/screen-settings";
import { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { setLocale, t } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

const IDLE_POOL = {
  vrma_path: "/motions/calm.vrma",
  variants: ["/motions/calm.vrma", "/motions/idle_01.vrma"],
};
const EXPRESS_VOCAB = ["happy", "laugh"];

describe("createQuickControls — settings layout", () => {
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
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // Every optional section wired in, so the whole panel renders.
  function buildFullQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
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

  function panel(qc: ReturnType<typeof createQuickControls>, tab: string): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`#yui-panel-${tab}`)!;
  }

  it("puts the four endpoint sections in the Connection tab", () => {
    const qc = buildFullQc();
    qc.open();

    const svcs = Array.from(panel(qc, "conn").querySelectorAll<HTMLElement>(".yui-endpoints"));
    expect(svcs.map((s) => s.dataset.svc)).toEqual(["chat", "stt", "tts", "broker"]);

    qc.dispose();
  });

  it("puts the display language, performance switches and session in the General tab", () => {
    const qc = buildFullQc();
    qc.open();

    const general = panel(qc, "general");
    expect(general.querySelector(".yui-lang-seg")).not.toBeNull();
    expect(general.querySelector(".yui-idle-throttle-switch")).not.toBeNull();
    expect(general.querySelector(".yui-session")).not.toBeNull();
    expect(panel(qc, "talk").querySelector(".yui-lang-seg")).toBeNull();

    qc.dispose();
  });

  it("renders no <details> except the filler's more-phrases disclosure", () => {
    const qc = buildFullQc();
    qc.open();

    const details = Array.from(qc.el.querySelectorAll("details"));
    expect(details).toHaveLength(1);
    expect(details[0]!.classList.contains("yui-filler-more")).toBe(true);

    qc.dispose();
  });

  it("sizes a segment by its options — three buttons, no sliding indicator", () => {
    const qc = buildFullQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    expect(seg.querySelectorAll(".yui-seg__btn")).toHaveLength(3);
    expect(qc.el.querySelector(".yui-seg__ind")).toBeNull();

    qc.dispose();
  });

  it("shows the screenshot row's on/off hint as its sub text and no footer", () => {
    const settings = createScreenshotSettings({ storage: { load: () => null, save: () => {} } });
    const qc = buildFullQc({ settings });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
    const sub = sw.closest(".yui-row")!.querySelector(".yui-row__sub")!;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sub.textContent).toBe(t("screenshot.foot_off"));

    settings.setEnabled(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sub.textContent).toBe(t("screenshot.foot_on"));
    expect(qc.el.querySelector(".yui-quick__foot")).toBeNull();

    qc.dispose();
  });
});
