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

/** The four io/chat conversation stores every window constructs, syncs, and disposes as one bag. */
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

/**
 * Every store reloads on a remote change; only the transcript broadcasts its own edits, so the
 * settings window's History tab updates as turns land in the pet window.
 */
export function conversationSyncStores(bag: ConversationStores): {
  extraReload: ConversationStores[keyof ConversationStores][];
  extraBroadcast: ConversationStores["chatHistoryStore"][];
} {
  return { extraReload: Object.values(bag), extraBroadcast: [bag.chatHistoryStore] };
}
