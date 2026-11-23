// @vitest-environment jsdom
/** The Session section through the History page: when the readout and the lost line redraw, and what disposal releases. */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../../../io/chat/conversation/chat-history-store";
import { createSessionDiagnosticsStore } from "../../../../io/chat/conversation/session-diagnostics";
import { createSessionStore } from "../../../../io/chat/conversation/session-store";
import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import type { Logger } from "../../../../logger";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { setLocale } from "../../../i18n";
import type { PushSocketPanelPort } from "../../connection/connection-page";
import { createDelegationFeed } from "../../delegations/delegation-feed";
import { countSubscriptions, inMemoryAgentStorage } from "../../test-helpers";
import { createHistoryPage } from "../history-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RUNNING: DelegationItem = { id: "d-1", title: "work d-1", started_at: 0, state: "running" };

const pages: ReturnType<typeof createHistoryPage>[] = [];

function build({ open = true, pushMode = true }: { open?: boolean; pushMode?: boolean } = {}) {
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
    sendReset: () => true,
    reconnectNow: () => {},
  } satisfies PushSocketPanelPort;

  const page = createHistoryPage({
    transcript: createChatHistoryStore(),
    sessionDiagnostics,
    sessionStore: createSessionStore(),
    pushSocket,
    isPushMode: () => pushMode,
    delegations: createDelegationFeed({ get: () => [RUNNING], subscribe: () => () => {} }),
    agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
    isOpen: () => open,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger,
  });
  pages.push(page);

  return {
    page,
    sessionDiagnostics,
    sessionCounts,
    pushListeners,
    lostLine: () => page.el.querySelector<HTMLElement>(".yui-session__deleg-lost")!,
    readout: () => page.el.querySelector<HTMLElement>(".yui-session__value")!,
    setPushState(next: PushSocketState) {
      pushState = next;
      act(() => {
        for (const cb of [...pushListeners]) cb(next);
      });
    },
  };
}

describe("the Session section", () => {
  beforeEach(() => setLocale("en"));

  afterEach(() => {
    act(() => {
      for (const page of pages.splice(0)) page.dispose();
    });
    document.body.innerHTML = "";
  });

  it("a push-state or diagnostics change redraws while open and not while closed", () => {
    const closed = build({ open: false });
    closed.setPushState({ kind: "connecting" });
    act(() => closed.sessionDiagnostics.setUsage(18200, 200000));
    expect(closed.lostLine().hidden).toBe(true);
    expect(closed.readout().textContent).toBe("—");

    const opened = build();
    opened.setPushState({ kind: "connecting" });
    act(() => opened.sessionDiagnostics.setUsage(18200, 200000));
    expect(opened.lostLine().hidden).toBe(false);
    expect(opened.readout().textContent).toContain("18.2K");
  });

  it("the lost line follows the socket only while push chat is effective", () => {
    const { lostLine, setPushState } = build({ pushMode: false });

    setPushState({ kind: "connecting" });

    expect(lostLine().hidden).toBe(true);
  });

  it("dispose() releases the push and diagnostics sources", () => {
    const { page, sessionCounts, pushListeners } = build();

    act(() => page.dispose());

    expect(pushListeners.size).toBe(0);
    expect(sessionCounts.taken).toBeGreaterThan(0);
    expect(sessionCounts.released).toBe(sessionCounts.taken);
  });

  it("after dispose() no notification redraws the section", () => {
    const { page, lostLine, readout, sessionDiagnostics, setPushState } = build();
    const lost = lostLine();
    const value = readout();

    act(() => page.dispose());
    setPushState({ kind: "connecting" });
    act(() => sessionDiagnostics.setUsage(18200, 200000));

    expect(lost.hidden).toBe(true);
    expect(value.textContent).toBe("—");
  });
});
