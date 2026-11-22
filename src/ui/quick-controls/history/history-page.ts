/** The History page: its React root, and what the panel's open redraws. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import { resetConversation } from "../../../io/chat/conversation/reset-conversation";
import type { createSessionDiagnosticsStore } from "../../../io/chat/conversation/session-diagnostics";
import type { createSessionStore } from "../../../io/chat/conversation/session-store";
import type { createSignalHistoryStore } from "../../../io/chat/conversation/signal-history-store";
import type { Logger } from "../../../logger";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type { PushSocketPanelPort } from "../connection/connection-tab";
import { editedCharacterName } from "./character-name";
import type { DelegationFeed } from "./delegations/delegation-feed";
import { HistoryPageView } from "./history-page-view";
import { createHistoryPorts } from "./history-ports";

export interface HistoryPage {
  el: HTMLElement;
  /** Re-reads every source and disarms a pending start-fresh confirm — the open hook. */
  refresh(): void;
  dispose(): void;
}

export function createHistoryPage(deps: {
  /** Unified conversation transcript. Feeds the list; "Start fresh" closes the running session in it. */
  transcript: Pick<
    ReturnType<typeof createChatHistoryStore>,
    "startNewSession" | "current" | "subscribe"
  >;
  /** Signal records shown beside the turns they ran in. */
  signalHistory?: Pick<ReturnType<typeof createSignalHistoryStore>, "current" | "subscribe">;
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** Current session id pointer. "Start fresh" clears it along with diagnostics. */
  sessionStore?: ReturnType<typeof createSessionStore>;
  /** Tells the preset's other windows, and this window's greeting, that a new session opened. */
  announceSessionReset?: () => void;
  /** The push transport — "Start fresh" resets the conversation on it in push mode. */
  pushSocket?: PushSocketPanelPort;
  /** Whether push chat is the effective protocol. */
  isPushMode: () => boolean;
  delegations: DelegationFeed;
  /** With the persona, names the character's lines. */
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "get">;
  getPersona?: () => PersonaConfig | undefined;
  /** The sources redraw the page only while the panel is open. */
  isOpen: () => boolean;
  log: Logger;
}): HistoryPage {
  const { transcript, sessionDiagnostics, sessionStore, pushSocket } = deps;
  // The readout and start fresh need both reset stores; the list alone renders without them.
  const session =
    sessionDiagnostics && sessionStore ? { sessionDiagnostics, sessionStore } : undefined;
  const ports = createHistoryPorts({
    ...deps,
    sessionDiagnostics: session?.sessionDiagnostics,
    // The lost line belongs to the delegated list, so it shows only with one.
    pushSocket: deps.delegations.present ? pushSocket : undefined,
  });

  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  const props = {
    ports,
    delegations: deps.delegations,
    characterName: () => editedCharacterName(deps.agentSettings.get(), deps.getPersona?.()),
    onReset:
      session &&
      (() =>
        resetConversation({
          transcript,
          ...session,
          announceSessionReset: deps.announceSessionReset,
          push: deps.isPushMode() ? pushSocket : undefined,
          log: deps.log,
        })),
  };
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(HistoryPageView, { ...props, revision })));
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
