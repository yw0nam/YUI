import type { EndpointsConfig } from "../contract";
import type { PushTurns } from "../dispatcher/turn/push-turn";
import { createRenderTurn } from "../dispatcher/turn/render-turn";
import type { TurnFeed } from "../dispatcher/turn/turn-feed";
import type { TurnOutput } from "../dispatcher/turn/turn-output";
import type { DelegationHistory } from "../io/bridge/delegation-history";
import type { DelegationsStore } from "../io/bridge/delegations-store";
import type { ChatHistoryEntry } from "../io/chat/chat-history-store";
import type {
  DelegationItem,
  PushSocket,
  PushSocketState,
  RenderFrame,
  SpeechFrame,
  ToolStatusFrame,
  TurnEndFrame,
} from "../io/chat/push-socket";
import type { RenderRecord } from "../io/chat/turn-record-log";
import type { Logger } from "../logger";

/**
 * Routes an open push socket into the client: a `render` frame plays as a turn and closes the
 * live reasoning cycle, a `speech` frame plays into the utterance its turn's `render` closes, a
 * `reasoning` frame appends to the cycle, a `tool_status` frame names the tool to the chip and to
 * the turn's own waiter, and a `delegations` frame replaces the tracked list. The socket itself
 * is created and connected by the host, which owns its lifetime.
 */
export function wirePushTransport(deps: {
  socket: {
    onRender(cb: (frame: RenderFrame) => void): () => void;
    onSpeech(cb: (frame: SpeechFrame) => void): () => void;
    onTurnEnd(cb: (frame: TurnEndFrame) => void): () => void;
    onToolStatus(cb: (frame: ToolStatusFrame) => void): () => void;
    onDelegations(cb: (items: DelegationItem[]) => void): () => void;
    onReasoning(cb: (delta: string) => void): () => void;
    onState(cb: (state: PushSocketState) => void): () => void;
  };
  turnOutput: TurnOutput;
  /** Which push turns the user stopped — a frame of one of them never plays. */
  pushTurns: PushTurns;
  delegations: DelegationsStore;
  /** The persisted list every `delegations` frame folds into. */
  delegationHistory: Pick<DelegationHistory, "merge">;
  /** The shared tool-chip/reasoning consumer — the socket feeds it under push owners. */
  turnFeed: TurnFeed;
  appendTurnRecord: (record: RenderRecord) => void;
  /** Conversation transcript — the reply half of a push turn lands here. */
  appendTranscript: (entry: ChatHistoryEntry) => void;
  log: Logger;
}): () => void {
  const renderTurn = createRenderTurn({
    turnOutput: deps.turnOutput,
    pushTurns: deps.pushTurns,
    appendTurnRecord: deps.appendTurnRecord,
    appendTranscript: deps.appendTranscript,
  });
  const unsubscribes = [
    deps.socket.onRender((frame) => {
      // A dropped frame puts no reply in the message window, so its reasoning has nothing to sit
      // under: the cycle it was writing is abandoned, an earlier finished text is left alone.
      if (renderTurn.render(frame)) deps.turnFeed.replied("push:reasoning", frame.reasoning);
      else deps.turnFeed.ended("push:reasoning");
    }),
    deps.socket.onSpeech((frame) => renderTurn.stream(frame)),
    deps.socket.onTurnEnd((frame) => {
      renderTurn.close(frame.turn_id);
      // The frame the running state was waiting for: the turn is forgotten, whatever it held.
      deps.pushTurns.ended(frame.turn_id);
      deps.log.info("push.turn_end", { turn_id: frame.turn_id });
      deps.turnFeed.ended(`push:turn:${frame.turn_id}`);
    }),
    deps.socket.onToolStatus((frame) => {
      // A cut turn's frames never play, so the chip never lights for one.
      if (deps.pushTurns.isCut(frame.turn_id)) {
        deps.log.debug("push.tool_status", {
          turn_id: frame.turn_id,
          tool_id: frame.tool_id,
          dropped: "cut_turn",
          stopped_count: deps.pushTurns.cutCount(),
        });
        return;
      }
      // Latest wins: the chip is a single slot.
      deps.turnFeed.toolStatus(`push:turn:${frame.turn_id}`, frame.state, frame.tool_id);
      deps.pushTurns.toolStatus(frame.turn_id, frame.state, frame.tool_id);
      deps.log.debug("push.tool_status", {
        turn_id: frame.turn_id,
        state: frame.state,
        tool_id: frame.tool_id,
      });
    }),
    deps.pushTurns.onCut((turnId) => renderTurn.drop(turnId)),
    deps.socket.onDelegations((items) => {
      // The history reaches storage before the live list's bridge emit tells the settings window to reload.
      deps.delegationHistory.merge(items);
      deps.delegations.replace(items);
      const running = items.filter((item) => item.state === "running").length;
      deps.log.info("delegations", { total: items.length, running });
    }),
    deps.socket.onReasoning((delta) => deps.turnFeed.reasoning("push:reasoning", delta)),
    deps.socket.onState((state) => {
      if (state.kind === "ready") return;
      // Whatever the socket still held — a live cycle, a running tool — dies with the connection.
      deps.turnFeed.sourceLost("push");
      renderTurn.close();
    }),
  ];
  return () => {
    for (const off of unsubscribes) off();
    deps.turnFeed.sourceLost("push");
    renderTurn.dispose();
  };
}

/**
 * The stop button: ends the turns outstanding on the chat and tells the backend which ones went,
 * so the ones it still runs for the user stop with them. A typed or spoken turn and a barge-in
 * reach the backend as `turn` frames instead, and a session reset sends `reset`.
 */
export function wireStopButton(deps: {
  onStop(cb: () => void): void;
  stopTurn: () => string[];
  socket: Pick<PushSocket, "sendStop"> | undefined;
  log: Logger;
}): void {
  deps.onStop(() => {
    const turnIds = deps.stopTurn();
    if (turnIds.length > 0 && deps.socket?.sendStop(turnIds)) {
      deps.log.info("push.stop", { count: turnIds.length });
    }
  });
}

/**
 * Keeps the push socket and the delegation chip on whatever the chat settings now say. The socket
 * opens once the protocol is push and an endpoint is set, closes when the protocol changes, and
 * reopens on an endpoint or key edit so the next attempt reads the new value — every other
 * endpoint setting applies live too. The chip is mounted for push mode regardless of the endpoint
 * and draws only what the socket reports; it survives an endpoint or key edit that keeps the mode
 * as push.
 */
export function wirePushMode(deps: {
  socket: Pick<PushSocket, "connect" | "disconnect">;
  chip: { create(): void; dispose(): void };
  /** Effective endpoints, read at call time. */
  getEndpoints: () => Pick<EndpointsConfig, "chat_api" | "chat_base_url">;
  endpointsSettings: { subscribe(cb: () => void): () => void };
  chatKeySettings: { subscribe(cb: () => void): () => void };
}): () => void {
  // The endpoint the socket is currently on, or null while it is meant to be down.
  let openOn: string | null = null;
  let chipOpen = false;

  /** Where the socket belongs now, or null when push mode is off or unconfigured. */
  function target(): string | null {
    const endpoints = deps.getEndpoints();
    if (endpoints.chat_api !== "push") return null;
    return deps.getEndpoints().chat_base_url.trim() || null;
  }

  function apply(reopen: boolean): void {
    const pushMode = deps.getEndpoints().chat_api === "push";
    if (pushMode && !chipOpen) {
      deps.chip.create();
      chipOpen = true;
    } else if (!pushMode && chipOpen) {
      deps.chip.dispose();
      chipOpen = false;
    }

    const next = target();
    if (next === null) {
      if (openOn !== null) deps.socket.disconnect();
      openOn = null;
      return;
    }
    if (openOn === next && !reopen) return;
    if (openOn !== null) deps.socket.disconnect();
    deps.socket.connect();
    openOn = next;
  }

  apply(false);
  const unsubscribes = [
    deps.endpointsSettings.subscribe(() => apply(false)),
    // The key is not part of the target, so an edit to it asks for the reopen explicitly.
    deps.chatKeySettings.subscribe(() => apply(true)),
  ];
  return () => {
    for (const off of unsubscribes) off();
    if (chipOpen) {
      deps.chip.dispose();
      chipOpen = false;
    }
  };
}
