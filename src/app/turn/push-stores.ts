import type { EndpointsConfig } from "../../contract";
import {
  createDelegationHistory,
  type DelegationHistory,
} from "../../io/bridge/delegation-history";
import { publishDelegations } from "../../io/bridge/delegations-bridge";
import { createDelegationsStore, type DelegationsStore } from "../../io/bridge/delegations-store";
import { publishPushSocket } from "../../io/bridge/push-socket-bridge";
import { publishReasoning } from "../../io/bridge/reasoning-bridge";
import { createReasoningStore, type ReasoningStore } from "../../io/bridge/reasoning-store";
import type { BrokerPayload } from "../../io/chat/broker-client";
import { createPushSocket, type PushSocket, pushVocabularyOf } from "../../io/chat/push-socket";
import {
  createChatIdSettings,
  localStorageChatIdStorage,
} from "../../settings/backend/chat-id-settings";

/**
 * The push protocol's shared stores — the socket, the chat id it identifies with, and the
 * delegations and reasoning its frames feed. Inert until bind(): the vocabulary is empty and the
 * stop is a no-op until the configured bootstrap wires them.
 */
type PushStores = ReturnType<typeof createPushStores>;

export function createPushStores(deps: {
  getEndpoints: () => Pick<EndpointsConfig, "chat_base_url">;
  getChatKey: () => Promise<string | undefined>;
  register: (fn: () => void) => void;
}): {
  pushSocket: PushSocket;
  delegations: DelegationsStore;
  delegationHistory: DelegationHistory;
  reasoning: ReasoningStore;
  stopTurn(): void;
  bind(deps: { vocabulary: () => BrokerPayload; stopTurn: () => void }): void;
} {
  let publishedVocabulary: (() => BrokerPayload) | null = null;
  // The panel's session reset stops the running turn the way the stop button does; the shared
  // closure exists once the configured bootstrap has wired it.
  let stopTurn: () => void = () => {};
  const chatIdSettings = createChatIdSettings({ storage: localStorageChatIdStorage() });
  const pushSocket = createPushSocket({
    chatBaseUrl: () => deps.getEndpoints().chat_base_url,
    chatId: () => chatIdSettings.get().chat_id,
    getKey: deps.getChatKey,
    vocabulary: () => pushVocabularyOf(publishedVocabulary?.()),
  });
  deps.register(pushSocket.dispose);
  deps.register(chatIdSettings.dispose);
  // The backend's delegations frames land here; the chip and the settings mirror both read it.
  const delegations = createDelegationsStore();
  const delegationHistory = createDelegationHistory();
  deps.register(delegationHistory.dispose);
  // The backend's reasoning deltas land here; the message window's chip mirrors it.
  const reasoning = createReasoningStore();
  return {
    pushSocket,
    delegations,
    delegationHistory,
    reasoning,
    stopTurn: () => stopTurn(),
    bind: (bound) => {
      publishedVocabulary = bound.vocabulary;
      stopTurn = bound.stopTurn;
    },
  };
}

/** Serves the push stores to the other windows, which read them over the bridge. */
export function publishPushStores(
  stores: PushStores,
  bridge: Parameters<typeof publishPushSocket>[0]["bridge"] &
    Parameters<typeof publishDelegations>[0]["bridge"] &
    Parameters<typeof publishReasoning>[0]["bridge"],
  register: (fn: () => void) => void,
): void {
  // The settings window has no socket of its own: it reads this one and asks it to reset.
  register(publishPushSocket({ socket: stores.pushSocket, stopTurn: stores.stopTurn, bridge }));
  // The delegations list rides the same bridge; a fresh settings window asks for the current list.
  register(publishDelegations({ store: stores.delegations, bridge }));
  register(publishReasoning({ store: stores.reasoning, bridge }));
}
