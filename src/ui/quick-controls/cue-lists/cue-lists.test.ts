// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../io/assets/vrm-selection";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../../io/voice/voices/speaker-selection";
import { createLipsyncSettings } from "../../../settings/avatar/lipsync-settings";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
import { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "../test-helpers";
import { mountCueLists } from "./cue-lists";

const SECTION = '[data-testid="cue-section"]';

type Subscribable = { subscribe(cb: never): () => void };

/** Counts the store's live listeners and logs `sub:`/`unsub:` per label. */
function watch(store: Subscribable, order: string[], label: string) {
  const state = { live: 0 };
  const real = store.subscribe.bind(store) as (cb: unknown) => () => void;
  vi.spyOn(store, "subscribe").mockImplementation(((cb: unknown) => {
    state.live++;
    order.push(`sub:${label}`);
    const off = real(cb);
    return () => {
      order.push(`unsub:${label}`);
      state.live--;
      off();
    };
  }) as never);
  return state;
}

function setup() {
  const scheduleMount = document.createElement("div");
  const proactiveMount = document.createElement("div");
  const scheduleSettings = createScheduleSettings();
  const proactiveSettings = createProactiveSettings();
  const order: string[] = [];
  const schedule = watch(scheduleSettings, order, "schedule");
  const proactive = watch(proactiveSettings, order, "proactive");
  const cueLists = mountCueLists({
    scheduleMount,
    proactiveMount,
    scheduleSettings,
    proactiveSettings,
  });
  return { cueLists, scheduleMount, proactiveMount, schedule, proactive, order };
}

describe("mountCueLists", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts the schedule list and the proactive list each into its own mount, replacing prior content", () => {
    const scheduleMount = document.createElement("div");
    const proactiveMount = document.createElement("div");
    scheduleMount.innerHTML = '<i class="stale"></i>';
    proactiveMount.innerHTML = '<i class="stale"></i>';

    mountCueLists({
      scheduleMount,
      proactiveMount,
      scheduleSettings: createScheduleSettings(),
      proactiveSettings: createProactiveSettings(),
    });

    expect(scheduleMount.querySelectorAll(SECTION)).toHaveLength(1);
    expect(proactiveMount.querySelectorAll(SECTION)).toHaveLength(1);
    expect(scheduleMount.querySelector(".stale")).toBeNull();
    expect(proactiveMount.querySelector(".stale")).toBeNull();
  });

  it("subscribes the schedule store before the proactive store", () => {
    const { order } = setup();

    expect(order).toEqual(["sub:schedule", "sub:proactive"]);
  });

  it("destroy removes both sections and leaves no listener on either store", () => {
    const { cueLists, scheduleMount, proactiveMount, schedule, proactive } = setup();
    expect([schedule.live, proactive.live]).toEqual([1, 1]);

    cueLists.destroy();

    expect(scheduleMount.querySelector(SECTION)).toBeNull();
    expect(proactiveMount.querySelector(SECTION)).toBeNull();
    expect([schedule.live, proactive.live]).toEqual([0, 0]);
  });

  it("destroys the schedule list before the proactive list", () => {
    const { cueLists, order } = setup();
    order.length = 0;

    cueLists.destroy();

    expect(order).toEqual(["unsub:schedule", "unsub:proactive"]);
  });
});

describe("createQuickControls — cue-list sections", () => {
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
});
