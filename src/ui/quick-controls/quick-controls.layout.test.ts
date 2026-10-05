// @vitest-environment jsdom
// Settings panel layout, section placement, segment sizing and screenshot hints.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/validators/avatar/types";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import { createSessionStore } from "../../io/chat/conversation/session-store";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import { createExpressMotionSettings } from "../../settings/avatar/express-motion-settings";
import { createIdleMotionSettings } from "../../settings/avatar/idle-motion-settings";
import { createLipsyncSettings } from "../../settings/avatar/lipsync-settings";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createAgentSettings } from "../../settings/backend/agent-settings";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { createGuardrailsSettings } from "../../settings/backend/guardrails-settings";
import { createScreenKnobSettings } from "../../settings/capture/screen-settings";
import { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { createProactiveSettings } from "../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../settings/cues/schedule-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createPacerGapStore, createPresenceStore } from "../../settings/settings-stores";
import { createFillerSettings, type FillerSettings } from "../../settings/voice/filler-settings";
import { createVadSettings } from "../../settings/voice/vad-settings";
import { setLocale, t } from "../i18n";
import { createQuickControls } from "./quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "./test-helpers";

/** A filler store hydrated from storage with the given settings. */
function seededFiller(settings: FillerSettings) {
  return createFillerSettings({ storage: { load: () => settings, save: () => {} } });
}

const inMemoryValueStorage = () => {
  let value: { value: number } | null = null;
  return {
    load: () => value,
    save: (next: { value: number }) => {
      value = next;
    },
  };
};

const inMemoryPresenceStore = () => createPresenceStore(inMemoryValueStorage());

const inMemoryPacerGapStore = () => createPacerGapStore(inMemoryValueStorage());

const SCREEN_DEFAULTS = {
  prev_dwell_ms: 600_000,
  settle_ms: 90_000,
  long_session_ms: 2_700_000,
  min_gap_ms: 300_000,
  quiet_after_turn_ms: 180_000,
  recent_cap: 5,
};

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

describe("createQuickControls — proactive tab layout", () => {
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
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({ ...defaultQcArgs(mount), ...extra });
  }

  function buildScreenQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const screenSettings = createFlagSettings(false);
    const screenKnobSettings = createScreenKnobSettings();
    return {
      screenSettings,
      screenKnobSettings,
      qc: buildQc({
        screenSettings,
        screenKnobSettings,
        getScreenDefaults: () => SCREEN_DEFAULTS,
        ...extra,
      }),
    };
  }

  // ── Tab identity ──────────────────────────────────────────────────────────

  it("names the react tab 말걸기 and tooltips it as the proactive rule hub", () => {
    const qc = buildQc();
    qc.open();
    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    expect(tab.getAttribute("aria-label")).toBe("말걸기");
    expect(tab.dataset.tip).toBe("유이가 먼저 말을 거는 규칙");
    expect(tab.hasAttribute("title")).toBe(false);
    qc.dispose();
  });

  // ── Cue-section relocation ────────────────────────────────────────────────

  it("mounts the cue-sections block in the proactive tab, not the input tab", () => {
    const qc = buildQc();
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    const cueSections = reactPanel.querySelector(".yui-cue-sections");
    expect(cueSections).not.toBeNull();
    expect(cueSections!.querySelector("[data-testid='cue-section']")).not.toBeNull();
    expect(inputPanel.querySelector(".yui-cue-sections")).toBeNull();
    expect(inputPanel.querySelector(".yui-loop-cue-section")).toBeNull();
    qc.dispose();
  });

  it("keeps the screenshot and voice rows in the input tab", () => {
    const qc = buildQc();
    qc.open();
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    expect(inputPanel.querySelector(".yui-screenshot-switch")).not.toBeNull();
    expect(inputPanel.querySelector(".yui-voice-switch")).not.toBeNull();
    qc.dispose();
  });

  // ── Section order ─────────────────────────────────────────────────────────

  it("orders the proactive tab: screen watch → cues → watchers → shared", () => {
    const { qc } = buildScreenQc({
      rateLimitSettings: createGuardrailsSettings(),
    });
    qc.open();
    const panel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const nodes = Array.from(panel.querySelectorAll("*"));
    const at = (sel: string) => nodes.indexOf(panel.querySelector(sel)!);
    expect(at(".yui-screen-switch")).toBeGreaterThanOrEqual(0);
    expect(at(".yui-screen-switch")).toBeLessThan(at(".yui-loop-cue-section"));
    expect(at(".yui-loop-cue-section")).toBeLessThan(at(".yui-cue-sections"));
    expect(at(".yui-cue-sections")).toBeLessThan(at(".yui-wf-list"));
    expect(at(".yui-wf-list")).toBeLessThan(at("#yui-rate-tier2"));
    qc.dispose();
  });
});

describe("createQuickControls — Reactions tab layout", () => {
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
    setLocale("en");
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      vrmSelection: makeVrmSelection(),
      speakerSelection: makeSpeakerSelection(),
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
    expect(tab!.getAttribute("aria-label")).toBe("Proactive");
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

  it("agentNotify switch lives inside #yui-panel-react, not #yui-panel-general", () => {
    const qc = buildQc({ agentNotifySettings: createAgentNotifySettings() });
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const generalPanel = qc.el.querySelector<HTMLElement>("#yui-panel-general")!;
    const agentNotifySwitch = qc.el.querySelector(".yui-agentnotify-switch");
    expect(agentNotifySwitch).not.toBeNull();
    expect(reactPanel.contains(agentNotifySwitch)).toBe(true);
    expect(generalPanel.contains(agentNotifySwitch)).toBe(false);
    qc.dispose();
  });

  it("renders #yui-presence inside #yui-panel-react when presenceSettings is provided", () => {
    const presenceSettings = inMemoryPresenceStore();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence");
    expect(presenceInput).not.toBeNull();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    expect(reactPanel.contains(presenceInput)).toBe(true);
    qc.dispose();
  });

  it("renders #yui-pacer-gap inside #yui-panel-react when pacerGapSettings is provided", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap");
    expect(input).not.toBeNull();
    expect(qc.el.querySelector<HTMLElement>("#yui-panel-react")!.contains(input)).toBe(true);
    qc.dispose();
  });

  // ── Rate-limit caps ───────────────────────────────────────────────────────

  const RATE_LIMIT_DEFAULTS = { tier2_max: 24, overall_max: 40 };

  function buildRateQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const rateLimitSettings = createGuardrailsSettings();
    return {
      rateLimitSettings,
      qc: buildQc({
        rateLimitSettings,
        getRateLimitDefaults: () => RATE_LIMIT_DEFAULTS,
        ...extra,
      }),
    };
  }

  it("renders the two rate-limit rows inside #yui-panel-react", () => {
    const { qc } = buildRateQc();
    qc.open();
    const panel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    for (const id of ["#yui-rate-tier2", "#yui-rate-overall"]) {
      const input = qc.el.querySelector<HTMLInputElement>(id);
      expect(input).not.toBeNull();
      expect(input!.type).toBe("number");
      expect(panel.contains(input)).toBe(true);
    }
    qc.dispose();
  });
});

describe("createQuickControls — filler tab layout", () => {
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
      vad,
      ...extra,
    });
  }

  // ── Thinking filler section ──────────────────────────────────────────────────

  function makeFillerSettings(over?: { enabled?: boolean; language?: "ja" | "en" | "ko" }) {
    return seededFiller({ enabled: true, language: "ja", customPools: {}, ...over });
  }

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
});

describe("createQuickControls — cue-list tab layout", () => {
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
  let removeVoice: Mock<(id: string) => Promise<void>>;

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
    removeVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
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
      removeVoice,
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
});
