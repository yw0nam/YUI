// @vitest-environment jsdom
/**
 * session-section.test.ts — the session readout and the delegated list on the panel's real markup:
 * what dispose() releases, the order inside it, and that nothing redraws or arms after it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionDiagnosticsStore } from "../../../../io/chat/conversation/session-diagnostics";
import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { DELEGATION_REFRESH_MS } from "../../../chips/delegation-rows";
import { setLocale } from "../../../i18n";
import type { PushSocketPanelPort } from "../../connection/connection-tab";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { countSubscriptions } from "../../test-helpers";
import { createSessionSection } from "./session-section";

const NOW = 1_789_365_900_000;
const RUNNING: DelegationItem = {
  id: "d-1",
  title: "work d-1",
  started_at: NOW - DELEGATION_REFRESH_MS,
  state: "running",
};

function build({ open = true, pushMode = true }: { open?: boolean; pushMode?: boolean } = {}) {
  const log: string[] = [];
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: true,
    hasSession: true,
    switchRows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(false),
      vad: createVadSettings(),
    }),
    showScreen: false,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: false,
    showHelp: false,
    showMessage: false,
    showHistory: false,
  });
  document.body.append(root);

  const sessionDiagnostics = createSessionDiagnosticsStore();
  const sessionCounts = countSubscriptions(sessionDiagnostics);

  let pushState: PushSocketState = { kind: "ready", chat_id: "chat-1" };
  const pushListeners = new Set<(state: PushSocketState) => void>();
  const pushSocket = {
    getState: () => pushState,
    onState(cb: (state: PushSocketState) => void) {
      pushListeners.add(cb);
      return () => {
        pushListeners.delete(cb);
      };
    },
  } satisfies Pick<PushSocketPanelPort, "getState" | "onState">;

  let items: DelegationItem[] = [RUNNING];
  const delegationListeners = new Set<() => void>();
  const delegations = {
    get: () => items,
    subscribe(cb: () => void) {
      delegationListeners.add(cb);
      return () => {
        log.push("unsub:delegations");
        delegationListeners.delete(cb);
      };
    },
  };

  const section = createSessionSection({
    root,
    sessionDiagnostics,
    pushSocket,
    isPushMode: () => pushMode,
    delegations,
    isOpen: () => open,
  });

  return {
    log,
    root,
    section,
    sessionDiagnostics,
    sessionCounts,
    pushListeners,
    delegationListeners,
    setPushState(next: PushSocketState) {
      pushState = next;
      for (const cb of [...pushListeners]) cb(next);
    },
    notifyDelegations(next: DelegationItem[]) {
      items = next;
      for (const cb of [...delegationListeners]) cb();
    },
  };
}

/** Tracks the delegation refresh interval: whether one is live, and `clearInterval` in the log. */
function watchRefreshTimer(log: string[]): { armed(): boolean } {
  let handle: unknown;
  const realSet = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
    const id = realSet(fn, ms);
    if (ms === DELEGATION_REFRESH_MS) handle = id;
    return id;
  }) as never);
  const realClear = globalThis.clearInterval;
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((id?: never) => {
    if (id !== undefined && id === handle) {
      log.push("clearInterval");
      handle = undefined;
    }
    realClear(id);
  }) as never);
  return { armed: () => handle !== undefined };
}

describe("createSessionSection", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    setLocale("en");
  });

  afterEach(() => {
    vi.clearAllTimers();
    document.body.innerHTML = "";
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("a push-state or diagnostics change redraws while open and not while closed", () => {
    const closed = build({ open: false });
    closed.setPushState({ kind: "connecting" });
    closed.sessionDiagnostics.setUsage(18200, 200000);
    expect(closed.root.querySelector<HTMLElement>(".yui-session__deleg-lost")!.hidden).toBe(true);
    expect(closed.root.querySelector(".yui-session__value")!.textContent).toBe("");

    const opened = build();
    opened.setPushState({ kind: "connecting" });
    opened.sessionDiagnostics.setUsage(18200, 200000);
    expect(opened.root.querySelector<HTMLElement>(".yui-session__deleg-lost")!.hidden).toBe(false);
    expect(opened.root.querySelector(".yui-session__value")!.textContent).toContain("18.2K");
  });

  it("the lost line follows the socket only while push chat is effective", () => {
    const { root, setPushState } = build({ pushMode: false });

    setPushState({ kind: "connecting" });

    expect(root.querySelector<HTMLElement>(".yui-session__deleg-lost")!.hidden).toBe(true);
  });

  it("dispose() releases the three sources and clears the refresh timer of a running item", () => {
    const { log, section, sessionCounts, pushListeners, delegationListeners } = build();
    const timer = watchRefreshTimer(log);
    section.reflect();
    expect(timer.armed()).toBe(true);

    section.dispose();

    expect(pushListeners.size).toBe(0);
    expect(delegationListeners.size).toBe(0);
    expect(sessionCounts.taken).toBeGreaterThan(0);
    expect(sessionCounts.released).toBe(sessionCounts.taken);
    expect(timer.armed()).toBe(false);
  });

  it("dispose() unsubscribes the delegations before it clears the refresh timer", () => {
    const built = build();
    watchRefreshTimer(built.log);
    built.section.reflect();
    built.log.length = 0;

    built.section.dispose();

    expect(built.log).toEqual(["unsub:delegations", "clearInterval"]);
  });

  it("after dispose() no notification redraws the section or arms the refresh timer", () => {
    const { log, root, section, sessionDiagnostics, setPushState, notifyDelegations } = build();
    const timer = watchRefreshTimer(log);
    const lostLine = root.querySelector<HTMLElement>(".yui-session__deleg-lost")!;
    const readout = root.querySelector<HTMLElement>(".yui-session__value")!;

    section.dispose();
    notifyDelegations([RUNNING]);
    setPushState({ kind: "connecting" });
    sessionDiagnostics.setUsage(18200, 200000);

    expect(timer.armed()).toBe(false);
    expect(lostLine.hidden).toBe(true);
    expect(readout.textContent).toBe("");
  });
});
