import {
  createChatHistoryStore,
  localStorageChatHistoryStorage,
} from "../../io/chat/chat-history-store";
import { createContextHistory, localStorageContextHistory } from "../../io/chat/context-history";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "../../io/chat/session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "../../io/chat/session-store";

/**
 * Cross-window conversation state: the four io/chat stores every window shares, composed here
 * because they span the pet, settings, and devtools windows rather than one setting or feature.
 * Each window constructs its own localStorage-backed instances, so sync and disposal treat the
 * bag as one unit.
 */
export function createConversationStores() {
  const contextHistory = createContextHistory({
    storage: localStorageContextHistory(),
  });
  // Session continuity: rotating response.id pointer plus usage diagnostics, synced cross-window.
  const sessionStore = createSessionStore(localStorageSessionStorage());
  const sessionDiagnostics = createSessionDiagnosticsStore(localStorageSessionDiagnosticsStorage());
  // Unified conversation transcript — both protocol modes append, and only CC mode pulls its
  // outbound share from here. "Start new conversation" writes a session boundary instead of erasing it.
  const chatHistoryStore = createChatHistoryStore({ storage: localStorageChatHistoryStorage() });

  return {
    contextHistory,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
  };
}

export type ConversationStores = ReturnType<typeof createConversationStores>;
