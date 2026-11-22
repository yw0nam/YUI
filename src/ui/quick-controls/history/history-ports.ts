/** What the History page reads, each told to redraw only while the panel is open. */

import type { ChatHistoryItem } from "../../../io/chat/conversation/chat-history-store";
import type { SessionDiagnostics } from "../../../io/chat/conversation/session-diagnostics";
import type { SignalRecord } from "../../../io/chat/conversation/signal-history-store";
import type { PushSocketPanelPort } from "../connection/connection-tab";

export interface Readable<T> {
  current(): T;
  subscribe(cb: () => void): () => void;
}

export interface HistoryPorts {
  transcript: Readable<Readonly<ChatHistoryItem[]>>;
  signals: Readable<Readonly<SignalRecord[]>>;
  /** Absent where the context readout is not rendered. */
  diagnostics?: Readable<Readonly<SessionDiagnostics>>;
  /** Whether the push socket is down while push chat is effective. */
  lost: Readable<boolean>;
}

const NO_SIGNALS: Readonly<SignalRecord[]> = [];
const never = (): (() => void) => () => {};

export function createHistoryPorts(deps: {
  transcript: Readable<Readonly<ChatHistoryItem[]>>;
  signalHistory?: Readable<Readonly<SignalRecord[]>>;
  sessionDiagnostics?: Readable<Readonly<SessionDiagnostics>>;
  pushSocket?: Pick<PushSocketPanelPort, "getState" | "onState">;
  isPushMode: () => boolean;
  isOpen: () => boolean;
}): HistoryPorts {
  const { pushSocket, isPushMode, isOpen } = deps;
  const whileOpen =
    (subscribe: (cb: () => void) => () => void) =>
    (cb: () => void): (() => void) =>
      subscribe(() => {
        if (isOpen()) cb();
      });
  const readable = <T>(source: Readable<T>): Readable<T> => ({
    current: () => source.current(),
    subscribe: whileOpen((cb) => source.subscribe(cb)),
  });

  return {
    transcript: readable(deps.transcript),
    signals: deps.signalHistory
      ? readable(deps.signalHistory)
      : { current: () => NO_SIGNALS, subscribe: never },
    diagnostics: deps.sessionDiagnostics && readable(deps.sessionDiagnostics),
    lost: pushSocket
      ? {
          current: () => isPushMode() && pushSocket.getState().kind !== "ready",
          subscribe: whileOpen((cb) => pushSocket.onState(cb)),
        }
      : { current: () => false, subscribe: never },
  };
}
