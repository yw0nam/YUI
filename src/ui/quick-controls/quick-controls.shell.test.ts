// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/validators/avatar/types";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import { createSessionStore } from "../../io/chat/conversation/session-store";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../io/voice/voices/voice-import-flow";
import { createLipsyncSettings } from "../../settings/avatar/lipsync-settings";
import { createAgentSettings } from "../../settings/backend/agent-settings";
import { createChatKeySettings } from "../../settings/backend/api-key-settings";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { createGuardrailsSettings } from "../../settings/backend/guardrails-settings";
import { createProactiveSettings } from "../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../settings/cues/schedule-settings";
import { createMessageWindowSettings } from "../../settings/panels/message-window-settings";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { DELEGATION_REFRESH_MS } from "../chips/delegation-rows";
import { createVoiceInputStatus } from "../chips/voice-input-status";
import { setLocale } from "../i18n";
import { createQuickControls } from "./quick-controls";
import {
  countSubscriptions,
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSettings,
  makeSpeakerSelection,
  makeVrmSelection,
} from "./test-helpers";

describe("createQuickControls — shell", () => {
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

  it("renders the Developer Tools row only when its opener is provided", () => {
    const onOpenDevtools = vi.fn();
    const qc = buildQc({ onOpenDevtools });
    qc.open();

    const button = qc.el.querySelector<HTMLButtonElement>(".yui-devtools-open");
    expect(button).not.toBeNull();
    button!.click();
    expect(onOpenDevtools).toHaveBeenCalledOnce();

    qc.dispose();
    const withoutOpener = buildQc();
    expect(withoutOpener.el.querySelector(".yui-devtools-open")).toBeNull();
  });

  it("the settings window shows the Developer Tools row on General and opens it", () => {
    const onOpenDevtools = vi.fn();
    const qc = buildQc({ onOpenDevtools });

    qc.el.querySelector<HTMLButtonElement>("#yui-panel-general .yui-devtools-open")!.click();

    expect(onOpenDevtools).toHaveBeenCalledOnce();
    const button = qc.el.querySelector<HTMLButtonElement>(".yui-devtools-open")!;
    qc.dispose();
    button.click();
    expect(onOpenDevtools).toHaveBeenCalledOnce();
  });

  it("puts no native title over a tooltip target", () => {
    const qc = buildQc();

    for (const target of qc.el.querySelectorAll<HTMLElement>("[data-tip]")) {
      expect(target.parentElement?.closest("[title]")).toBeNull();
    }

    qc.dispose();
  });

  it("does not show a tooltip for programmatic panel focus but does for keyboard focus", () => {
    const qc = buildQc();

    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    qc.open();
    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();

    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    tab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")?.textContent).toBe(tab.dataset.tip);

    qc.dispose();
  });

  it("closes both a keyboard-focused tab tooltip and the window on Escape", () => {
    const onCloseWindow = vi.fn<() => void>();
    const qc = buildQc({ onCloseWindow });
    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    tab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")).not.toBeNull();

    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();
    expect(onCloseWindow).toHaveBeenCalledOnce();
    qc.dispose();
  });

  it("opens a tooltip when Home or End is the first keyboard-modality key after a pointer click", () => {
    const qc = buildQc();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
    const firstTab = tabs[0]!;
    const lastTab = tabs[tabs.length - 1]!;
    const reactTab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;

    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    reactTab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();
    reactTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.querySelector(".yui-hint-tip.is-open")?.textContent).toBe(firstTab.dataset.tip);

    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    reactTab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();
    reactTab.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.querySelector(".yui-hint-tip.is-open")?.textContent).toBe(lastTab.dataset.tip);

    qc.dispose();
  });

  // ── Escape closes the window ──

  it("Escape invokes the host's OS-window close path", () => {
    const onCloseWindow = vi.fn<() => void>();
    const qc = buildQc({ onCloseWindow });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCloseWindow).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("Escape flushes a dirty typed key before closing", () => {
    const chatKeySettings = createChatKeySettings();
    const onCloseWindow = vi.fn<() => void>();
    const qc = buildQc({ chatKeySettings, onCloseWindow });

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
});

// Order and teardown around the two blocks the shell hands to its helpers: the cue-list mount and
// the delegation refresh timer.
describe("createQuickControls — construction and disposal", () => {
  const NOW = 1_789_365_900_000;
  let mount: HTMLElement;
  let log: string[];

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    mount = document.createElement("div");
    document.body.appendChild(mount);
    log = [];
  });

  afterEach(() => {
    vi.clearAllTimers();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  type Traceable = { subscribe(cb: never): () => void };

  /** Logs `sub:<label>` on subscribe and `unsub:<label>` on unsubscribe. */
  function trace(store: Traceable, label: string): void {
    const real = store.subscribe.bind(store) as (cb: unknown) => () => void;
    vi.spyOn(store, "subscribe").mockImplementation(((cb: unknown) => {
      log.push(`sub:${label}`);
      const off = real(cb);
      return () => {
        log.push(`unsub:${label}`);
        off();
      };
    }) as never);
  }

  function makeDelegations(initial: DelegationItem[]) {
    const subs = new Set<(items: DelegationItem[]) => void>();
    return {
      get: () => initial,
      subscribe(cb: (items: DelegationItem[]) => void) {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
    };
  }

  const RUNNING: DelegationItem = {
    id: "d-1",
    title: "work d-1",
    started_at: NOW - DELEGATION_REFRESH_MS,
    state: "running",
  };

  function build(
    opts: { delegations?: ReturnType<typeof makeDelegations>; refreshVoiceList?: () => void } = {},
  ) {
    watchDelegationTimer();
    // A plain subscribe, so the trace wraps it instead of the mock's own implementation.
    const settings = { ...makeSettings(), subscribe: () => () => {} };
    const base = defaultQcArgs(mount);
    const scheduleSettings = createScheduleSettings();
    const proactiveSettings = createProactiveSettings();
    const messageWindowSettings = createMessageWindowSettings();
    const voiceStatus = createVoiceInputStatus();
    trace(settings, "settings");
    trace(base.idleThrottleSettings, "idleThrottle");
    trace(messageWindowSettings, "messageWindow");
    trace(scheduleSettings, "schedule");
    trace(proactiveSettings, "proactive");
    trace(voiceStatus, "voice");
    if (opts.delegations) trace(opts.delegations, "delegations");
    return createQuickControls({
      ...base,
      settings,
      scheduleSettings,
      proactiveSettings,
      messageWindowSettings,
      voiceStatus,
      transcript: createChatHistoryStore(),
      sessionStore: createSessionStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
      ...(opts.delegations ? { delegations: opts.delegations } : {}),
      ...(opts.refreshVoiceList ? { refreshVoiceList: opts.refreshVoiceList } : {}),
    });
  }

  /** The handle of the delegation refresh interval, and the clearInterval calls seen after it. */
  function watchDelegationTimer() {
    let handle: unknown;
    const realSet = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
      const id = realSet(fn, ms);
      if (ms === DELEGATION_REFRESH_MS) handle = id;
      return id;
    }) as never);
    const realClear = globalThis.clearInterval;
    vi.spyOn(globalThis, "clearInterval").mockImplementation(((id?: never) => {
      if (id !== undefined && id === handle) log.push("clearInterval:delegations");
      realClear(id);
    }) as never);
  }

  it("opens the panel only after both cue lists have mounted", () => {
    const seen: { log: string[]; cueSections: number }[] = [];
    const qc = build({
      refreshVoiceList: () =>
        seen.push({
          log: [...log],
          cueSections: mount.querySelectorAll('[data-testid="cue-section"]').length,
        }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.cueSections).toBe(2);
    expect(seen[0]!.log).toEqual(
      expect.arrayContaining(["sub:schedule", "sub:proactive", "sub:voice"]),
    );

    qc.dispose();
  });

  describe("teardown", () => {
    it("without a throw: releases each traced store and the delegation timer once", () => {
      const delegations = makeDelegations([RUNNING]);
      const qc = build({ delegations });
      log.length = 0;

      qc.dispose();

      expect([...new Set(log)].sort()).toEqual(
        [
          "unsub:schedule",
          "unsub:proactive",
          "unsub:settings",
          "unsub:idleThrottle",
          "unsub:messageWindow",
          "unsub:voice",
          "unsub:delegations",
          "clearInterval:delegations",
        ].sort(),
      );
      expect(log).toHaveLength(8);
    });

    it("releases the speaker store", () => {
      const base = defaultQcArgs(mount);
      const counts = countSubscriptions(base.speakerSelection);
      const qc = createQuickControls(base);

      qc.dispose();

      expect(counts.taken).toBeGreaterThan(0);
      expect(counts.released).toBe(counts.taken);
    });

    it("releases the filler and transcript stores and detaches the panel and every root listener", () => {
      const base = defaultQcArgs(mount);
      const fillerSettings = createFillerSettings();
      const transcript = createChatHistoryStore();
      const fillerCounts = countSubscriptions(fillerSettings);
      const transcriptCounts = countSubscriptions(transcript);
      const onGuide = vi.fn();
      const qc = createQuickControls({
        ...base,
        fillerSettings,
        transcript,
        onGuide,
        rateLimitSettings: createGuardrailsSettings(),
      });
      const tabBefore = qc.selectedTab();

      qc.dispose();
      qc.el.querySelector<HTMLButtonElement>("#yui-tab-general")!.click();
      qc.el.querySelector<HTMLButtonElement>(".yui-help-btn")!.click();
      qc.el.querySelector<HTMLButtonElement>(".yui-hint-dot")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(qc.el.isConnected).toBe(false);
      expect(fillerCounts.taken).toBeGreaterThan(0);
      expect(fillerCounts.released).toBe(fillerCounts.taken);
      expect(transcriptCounts.taken).toBeGreaterThan(0);
      expect(transcriptCounts.released).toBe(transcriptCounts.taken);
      expect(qc.selectedTab()).toBe(tabBefore);
      expect(onGuide).not.toHaveBeenCalled();
      expect(document.getElementById("yui-hint-tip")).toBeNull();
      expect(qc.isOpen()).toBe(true);
    });

    it("stops at the first cleanup that throws: dispose() throws and the panel stays mounted", () => {
      const base = defaultQcArgs(mount);
      vi.spyOn(base.workflowSettings, "subscribe").mockImplementation((() => () => {
        throw new Error("workflows unsubscribe failed");
      }) as never);
      const qc = createQuickControls({ ...base });
      expect(qc.el.isConnected).toBe(true);

      expect(() => qc.dispose()).toThrow("workflows unsubscribe failed");
      expect(qc.el.isConnected).toBe(true);
    });
  });
});
