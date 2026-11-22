// @vitest-environment jsdom
/** The History page through its facade: the open hook that disarms a pending start-fresh confirm. */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import { createSessionDiagnosticsStore } from "../../../io/chat/conversation/session-diagnostics";
import { createSessionStore } from "../../../io/chat/conversation/session-store";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
import { createDelegationFeed } from "../delegations/delegation-feed";
import { inMemoryAgentStorage } from "../test-helpers";
import { createHistoryPage } from "./history-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: ReturnType<typeof createHistoryPage>[] = [];

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
});

describe("createHistoryPage", () => {
  it("refresh() disarms a pending start-fresh confirm", () => {
    const page = createHistoryPage({
      transcript: createChatHistoryStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
      sessionStore: createSessionStore(),
      isPushMode: () => false,
      delegations: createDelegationFeed(),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      isOpen: () => true,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    pages.push(page);
    const reset = page.el.querySelector<HTMLButtonElement>(".yui-session__reset")!;
    act(() => {
      fireEvent.click(reset);
    });
    expect(page.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(
      false,
    );

    act(() => page.refresh());

    expect(page.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(true);
    expect(page.el.querySelector<HTMLButtonElement>(".yui-session__reset")!.hidden).toBe(false);
  });
});
