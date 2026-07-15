// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import { createAgentNotifySettings } from "../../io/agent-notify-settings";
import { createAgentSettings } from "../../io/agent-settings";
import { createChatKeySettings } from "../../io/chat-key-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createPresenceSettings } from "../../io/presence-settings";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import { createSessionDiagnosticsStore } from "../../io/session-diagnostics";
import { createSessionStore } from "../../io/session-store";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import type { createVrmSelection } from "../../io/vrm-selection";
import { getLocale, subscribe as i18nSubscribe, LOCALE_DISPLAY_NAMES, setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
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
    importVoice = vi.fn<() => Promise<void>>(async () => {});
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
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
      importVoice,
      removeUserVoice,
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

  it("clicking the header close button closes the panel", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.isOpen()).toBe(true);

    const closeBtn = qc.el.querySelector<HTMLButtonElement>(
      ".yui-quick__bar-actions .yui-iconbtn:not(.yui-iconbtn--popout)",
    )!;
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

  it("reset confirm flow clears both the session store and diagnostics", () => {
    sessionStore.set("resp_x"); // populate so clear() actually fires
    sessionDiagnostics.setUsage(50000, 200000);
    const clearSession = vi.spyOn(sessionStore, "clear");
    const clearDiag = vi.spyOn(sessionDiagnostics, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    // the destructive action is gated behind a confirm affordance
    const link = qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!;
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(true);
    link.click();
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(false);

    qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click();
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearDiag).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("reset confirm flow also clears the transcript store when provided", () => {
    const transcript = { get: () => [], append: vi.fn(), clear: vi.fn() };

    const qc = buildQc({ variant: "window", transcript });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click();
    expect(transcript.clear).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("reset confirm flow works when the transcript store is not provided", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    expect(() =>
      qc.el.querySelector<HTMLButtonElement>(".yui-session .yui-pill--go")!.click(),
    ).not.toThrow();

    qc.dispose();
  });

  it("Cancel dismisses the confirm without clearing", () => {
    sessionStore.set("resp_y");
    const clearSession = vi.spyOn(sessionStore, "clear");

    const qc = buildQc({ variant: "window" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-link-btn")!.click();
    const cancel = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>(".yui-session .yui-pill"),
    ).find((b) => !b.classList.contains("yui-pill--go"))!;
    cancel.click();

    expect(clearSession).not.toHaveBeenCalled();
    expect(qc.el.querySelector<HTMLElement>(".yui-session .yui-confirm")!.hidden).toBe(true);

    qc.dispose();
  });

  it("live-updates the readout when the diagnostics store notifies while open", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    sessionDiagnostics.setUsage(100000, 200000);

    const value = qc.el.querySelector<HTMLElement>(".yui-session__value")!;
    expect(value.textContent).toContain("100K");
    expect(qc.el.querySelector<HTMLElement>(".yui-session__value .pct")!.textContent).toContain(
      "50%",
    );

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab layout + VAD silence-window slider
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — language picker", () => {
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
      ...extra,
    });
  }

  it("renders a 3-way language segmented control with display names", () => {
    const qc = buildQc();
    qc.open();
    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    expect(seg).not.toBeNull();
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    const locales = btns.map((b) => b.dataset.locale);
    expect(locales).toEqual(["ja", "en", "ko"]);
    const labels = btns.map((b) => b.textContent);
    expect(labels).toEqual([
      LOCALE_DISPLAY_NAMES.ja,
      LOCALE_DISPLAY_NAMES.en,
      LOCALE_DISPLAY_NAMES.ko,
    ]);
    qc.dispose();
  });

  it("reflects the current locale as the checked segment on render", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    const checked = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[aria-checked='true']",
    )!;
    expect(checked.dataset.locale).toBe("ko");
    qc.dispose();
  });

  it("clicking a language segment calls setLocale with that locale", () => {
    const qc = buildQc();
    qc.open();
    expect(getLocale()).toBe("en");
    const koBtn = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[data-locale='ko']",
    )!;
    koBtn.click();
    expect(getLocale()).toBe("ko");
    qc.dispose();
  });

  it("renders panel text via t() in the active locale", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    // The reasoning-effort field label is keyed; ko renders the Korean copy.
    const label = qc.el.querySelector<HTMLElement>(".yui-field-row__label")!;
    expect(label.textContent).toBe("추론 강도");
    qc.dispose();
  });

  it("arrow keys on the language seg move roving focus only — locale is NOT committed", () => {
    setLocale("en"); // en = index 1
    const qc = buildQc();
    qc.open();

    // Watch whether arrow keys call setLocale (subscription notifies on each setLocale).
    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
    btns[1].focus();

    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // No commit: locale and aria-checked stay put, only focus and roving tabindex move to ko.
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[2].getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(btns[2]);
    expect(btns[2].tabIndex).toBe(0);
    expect(btns[1].tabIndex).toBe(-1);

    // ArrowLeft moves focus back to en button only (still no commit).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(document.activeElement).toBe(btns[1]);
    expect(btns[1].tabIndex).toBe(0);

    unsub();
    qc.dispose();
  });

  it("Space on the focused locale button commits setLocale exactly once", () => {
    setLocale("en");
    const qc = buildQc();
    qc.open();

    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // Move focus to ko using arrow keys (no commit).
    btns[1].focus();
    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");

    // Space on focused button → commit (exactly once).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(commits).toBe(1);
    expect(getLocale()).toBe("ko");
    expect(btns[2].getAttribute("aria-checked")).toBe("true");
    expect(btns[1].getAttribute("aria-checked")).toBe("false");

    unsub();
    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reactions tab — new 5th tab + panel with loop cue, watchers, and shared rows
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — Reactions tab", () => {
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
    expect(tab!.textContent?.trim()).toBe("Reactions");
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

  it("schedule cue list stays in #yui-panel-input (.yui-cue-sections), not in react panel", () => {
    const qc = buildQc();
    qc.open();
    const inputPanel = qc.el.querySelector<HTMLElement>("#yui-panel-input")!;
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const cueSectionsInInput = inputPanel.querySelector(".yui-cue-sections");
    expect(cueSectionsInInput).not.toBeNull();
    expect(cueSectionsInInput!.querySelector("[data-testid='cue-section']")).not.toBeNull();
    // loop-cue-section must not be inside input panel
    expect(inputPanel.querySelector(".yui-loop-cue-section")).toBeNull();
    // cue-sections must not be inside react panel
    expect(reactPanel.querySelector(".yui-cue-sections")).toBeNull();
    qc.dispose();
  });

  it("agentNotify switch lives inside #yui-panel-react, not #yui-panel-adv", () => {
    const qc = buildQc({ agentNotifySettings: createAgentNotifySettings() });
    qc.open();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    const advPanel = qc.el.querySelector<HTMLElement>("#yui-panel-adv")!;
    const agentNotifySwitch = qc.el.querySelector(".yui-agentnotify-switch");
    expect(agentNotifySwitch).not.toBeNull();
    expect(reactPanel.contains(agentNotifySwitch)).toBe(true);
    expect(advPanel.contains(agentNotifySwitch)).toBe(false);
    qc.dispose();
  });

  it("renders #yui-agent-port that reflects agentNotifySettings.port on open", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port");
    expect(portInput).not.toBeNull();
    // Default port = 8770
    expect(portInput!.value).toBe("8770");
    qc.dispose();
  });

  it("change on #yui-agent-port calls agentNotifySettings.setPort", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "9000";
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(9000);
    qc.dispose();
  });

  it("does not render #yui-presence when presenceSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-presence")).toBeNull();
    qc.dispose();
  });

  it("renders #yui-presence inside #yui-panel-react when presenceSettings is provided", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence");
    expect(presenceInput).not.toBeNull();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    expect(reactPanel.contains(presenceInput)).toBe(true);
    qc.dispose();
  });

  it("#yui-presence reflects presenceSettings.present_max_idle_ms/1000 on open", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    // Default present_max_idle_ms = 180000 → 180 s
    expect(presenceInput.value).toBe("180");
    qc.dispose();
  });

  it("change on #yui-presence calls presenceSettings.setPresentMaxIdleMs(s * 1000)", () => {
    const presenceSettings = createPresenceSettings();
    const setSpy = vi.spyOn(presenceSettings, "setPresentMaxIdleMs");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "300";
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(300000);
    qc.dispose();
  });

  it("external presenceSettings.setPresentMaxIdleMs reflects into #yui-presence while open", () => {
    const presenceSettings = createPresenceSettings();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceSettings.setPresentMaxIdleMs(60000);
    expect(presenceInput.value).toBe("60");
    qc.dispose();
  });

  it("does not render #yui-recent-apps when recentAppsSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-recent-apps")).toBeNull();
    qc.dispose();
  });

  it("renders #yui-recent-apps inside #yui-panel-react when recentAppsSettings is provided", () => {
    const recentAppsSettings = createRecentAppsSettings();
    const qc = buildQc({ recentAppsSettings });
    qc.open();
    const recentAppsInput = qc.el.querySelector<HTMLInputElement>("#yui-recent-apps");
    expect(recentAppsInput).not.toBeNull();
    const reactPanel = qc.el.querySelector<HTMLElement>("#yui-panel-react")!;
    expect(reactPanel.contains(recentAppsInput)).toBe(true);
    qc.dispose();
  });

  it("change on #yui-recent-apps calls recentAppsSettings.setRecentAppsMax(n)", () => {
    const recentAppsSettings = createRecentAppsSettings();
    const setSpy = vi.spyOn(recentAppsSettings, "setRecentAppsMax");
    const qc = buildQc({ recentAppsSettings });
    qc.open();
    const recentAppsInput = qc.el.querySelector<HTMLInputElement>("#yui-recent-apps")!;
    recentAppsInput.value = "5";
    recentAppsInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(5);
    qc.dispose();
  });

  // ── Snap-back regression tests ────────────────────────────────────────────
  // When the store setter silently rejects an out-of-range value (no-op),
  // the change handler's explicit reflect.*() must snap the input back to the
  // current stored value so the field never shows an uncommitted state.

  it("below-range value in #yui-agent-port snaps back: store unchanged, input reverts to 8770", () => {
    const agentNotifySettings = createAgentNotifySettings(); // default port = 8770
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "80"; // below the 1024 minimum
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(80); // setter was invoked but rejected
    expect(agentNotifySettings.get().port).toBe(8770); // store unchanged
    expect(portInput.value).toBe("8770"); // input snapped back
    qc.dispose();
  });

  it("below-floor value in #yui-presence snaps back: store unchanged, input reverts to 180", () => {
    const presenceSettings = createPresenceSettings(); // default present_max_idle_ms = 180000
    const setSpy = vi.spyOn(presenceSettings, "setPresentMaxIdleMs");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "5"; // 5 s → 5000 ms — below the 10 000 ms floor
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(5000); // setter was invoked but rejected
    expect(presenceSettings.get().present_max_idle_ms).toBe(180000); // store unchanged
    expect(presenceInput.value).toBe("180"); // input snapped back
    qc.dispose();
  });
});

describe("createQuickControls — monitor picker error/empty state", () => {
  let mount: HTMLElement;

  // microtask flush — listMonitors is async; let its promise settle before asserting.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

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

  // Screenshot attach enabled so open() kicks off loadMonitors immediately.
  function makeEnabledSettings() {
    return {
      get: () => ({ enabled: true, source: { kind: "monitor" as const, index: 0 } }),
      setEnabled: vi.fn(),
      setSource: vi.fn(),
      reloadFromStorage: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      dispose: vi.fn(),
    };
  }

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      settings: makeEnabledSettings(),
      ...extra,
    });
  }

  it("renders one .yui-mon radio per monitor on success, no error/empty row", async () => {
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => [
          { index: 0, primary: true, width: 1920, height: 1080 },
          { index: 1, width: 2560, height: 1440 },
        ],
      },
    });
    qc.open();
    await flush();

    const rows = qc.el.querySelectorAll<HTMLButtonElement>(".yui-mon[role=radio]");
    expect(rows).toHaveLength(2);
    expect(qc.el.querySelector(".yui-mon__error")).toBeNull();
    expect(qc.el.querySelector(".yui-mon__empty")).toBeNull();

    qc.dispose();
  });

  it("renders an inline error row when listMonitors() rejects", async () => {
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => {
          throw new Error("enumeration failed");
        },
      },
    });
    qc.open();
    await flush();

    const err = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__error");
    expect(err).not.toBeNull();
    expect(err!.getAttribute("role")).toBe("status");
    expect(err!.textContent).toBe("Could not load the display list.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    qc.dispose();
  });

  it("renders an explicit empty state when listMonitors() resolves to []", async () => {
    const qc = buildQc({
      sourceProvider: { listMonitors: async () => [] },
    });
    qc.open();
    await flush();

    const empty = qc.el.querySelector<HTMLParagraphElement>(".yui-monitors .yui-mon__empty");
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("role")).toBe("status");
    expect(empty!.textContent).toBe("No displays found.");
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(0);

    qc.dispose();
  });

  it("retries loading on the next open after a failure", async () => {
    let fail = true;
    const qc = buildQc({
      sourceProvider: {
        listMonitors: async () => {
          if (fail) throw new Error("enumeration failed");
          return [{ index: 0, primary: true }];
        },
      },
    });
    qc.open();
    await flush();
    expect(qc.el.querySelector(".yui-mon__error")).not.toBeNull();

    fail = false;
    qc.close();
    qc.open();
    await flush();

    expect(qc.el.querySelector(".yui-mon__error")).toBeNull();
    expect(qc.el.querySelectorAll(".yui-mon[role=radio]")).toHaveLength(1);

    qc.dispose();
  });
});
