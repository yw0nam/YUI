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

  // ── pop-out button ────────────────────────────────────────────────────────

  it("clicking the pop-out button invokes onPopOut", () => {
    const qc = buildQc();
    qc.open();

    const popout = qc.el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout")!;
    popout.click();

    expect(onPopOut).toHaveBeenCalledOnce();

    qc.dispose();
  });

  // ── message button ────────────────────────────────────────────────────────

  it("renders the header Message button only when onMessage is provided", () => {
    const qc = buildQc({ onMessage: vi.fn() });
    expect(qc.el.querySelector(".yui-quick__bar .yui-iconbtn--message")).not.toBeNull();
    qc.dispose();

    const without = buildQc();
    expect(without.el.querySelector(".yui-iconbtn--message")).toBeNull();
    without.dispose();
  });

  it("clicking the Message button closes the panel, then calls onMessage", () => {
    let openWhenCalled: boolean | undefined;
    const qc = buildQc({ onMessage: () => (openWhenCalled = qc.isOpen()) });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-iconbtn--message")!.click();

    expect(openWhenCalled).toBe(false);
    qc.dispose();
  });

  it("keeps the pop-out button as the first focus stop when onMessage is set", () => {
    const qc = buildQc({ onMessage: vi.fn() });
    qc.open();

    expect(document.activeElement).toBe(qc.el.querySelector(".yui-iconbtn--popout"));
    qc.dispose();
  });

  it("the window variant renders no Message button", () => {
    const qc = buildQc({ variant: "window", onMessage: vi.fn() });
    expect(qc.el.querySelector(".yui-iconbtn--message")).toBeNull();
    qc.dispose();
  });

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

  it("clicking the header close button closes the panel", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.isOpen()).toBe(true);

    const closeBtn = qc.el.querySelector<HTMLButtonElement>(".yui-iconbtn--close")!;
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

  it("keeps the drag title on the grip and panel title without leaking onto tooltip targets", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();

    for (const target of qc.el.querySelectorAll<HTMLElement>("[data-tip]")) {
      expect(target.parentElement?.closest("[title]")).toBeNull();
    }
    const titled = Array.from(qc.el.querySelectorAll<HTMLElement>("[title]"));
    expect(titled).toHaveLength(2);
    expect(titled.map((element) => element.className)).toEqual([
      "yui-quick__grip",
      "yui-quick__title",
    ]);

    qc.dispose();
  });

  it("does not show a tooltip for programmatic panel focus but does for keyboard focus", () => {
    const qc = buildQc({ variant: "popover" });

    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    qc.open();
    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();

    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    tab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")?.textContent).toBe(tab.dataset.tip);

    qc.dispose();
  });

  it("closes both a keyboard-focused tab tooltip and the panel on Escape", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();
    const tab = qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    tab.focus();
    expect(document.querySelector(".yui-hint-tip.is-open")).not.toBeNull();

    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();
    expect(qc.isOpen()).toBe(false);
    qc.dispose();
  });

  it("opens a tooltip when Home or End is the first keyboard-modality key after a pointer click", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();

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
    opts: {
      variant?: "popover" | "window";
      delegations?: ReturnType<typeof makeDelegations>;
      refreshVoiceList?: () => void;
    } = {},
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
      variant: opts.variant ?? "popover",
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

  it("window variant opens the panel only after both cue lists have mounted", () => {
    const seen: { log: string[]; cueSections: number }[] = [];
    const qc = build({
      variant: "window",
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
      const qc = build({ variant: "window", delegations });
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

    it("releases the speaker store and detaches the header buttons", () => {
      const base = defaultQcArgs(mount);
      const counts = countSubscriptions(base.speakerSelection);
      const onPopOut = vi.fn();
      const qc = createQuickControls({ ...base, onPopOut });
      const popOut = qc.el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout")!;

      qc.dispose();
      popOut.click();

      expect(counts.taken).toBeGreaterThan(0);
      expect(counts.released).toBe(counts.taken);
      expect(onPopOut).not.toHaveBeenCalled();
    });

    it("releases the filler and transcript stores and detaches the panel, scrim and every root listener", () => {
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
      qc.open();
      const scrim = mount.querySelector(".yui-quick-scrim");
      expect(scrim).not.toBeNull();
      const tabBefore = qc.selectedTab();

      qc.dispose();
      qc.el.querySelector<HTMLButtonElement>("#yui-tab-general")!.click();
      qc.el.querySelector<HTMLButtonElement>(".yui-help-btn")!.click();
      qc.el.querySelector<HTMLButtonElement>(".yui-hint-dot")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(qc.el.isConnected).toBe(false);
      expect(scrim!.isConnected).toBe(false);
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
      const qc = createQuickControls({ ...base, variant: "window" });
      expect(qc.el.isConnected).toBe(true);

      expect(() => qc.dispose()).toThrow("workflows unsubscribe failed");
      expect(qc.el.isConnected).toBe(true);
    });
  });
});
