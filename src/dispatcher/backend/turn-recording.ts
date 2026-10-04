/** Records a sent turn into the transcript, the sent-context history, and the turn-record log. */
import type { ChatHistoryEntry } from "../../io/chat/chat-history-store";
import type { ContextHistoryEntry } from "../../io/chat/context-history";
import { buildTurnRecord, type TurnRecord } from "../../io/chat/turn-record-log";
import type { Logger } from "../../logger";
import type { buildContext } from "./context-builder";

export interface TurnRecordingDeps {
  transcript?: {
    append(e: ChatHistoryEntry): void;
    sessionToken(): string;
  };
  contextHistory?: { append(entry: ContextHistoryEntry): void };
  appendTurnRecord?: (record: TurnRecord) => void;
}

export interface SentTurn {
  eventName: string;
  userText: string | undefined;
  clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"];
  startSessionToken: string | undefined;
  /** The reply to append as the assistant entry; omitted when the reply is recorded elsewhere. */
  assistantText?: string;
  spokeText: boolean;
  /** Touches the transcript only for a turn that has user text, so a session reset logs nothing without it. */
  userHalfOnly?: boolean;
}

export function recordSentTurn(deps: TurnRecordingDeps, log: Logger, turn: SentTurn): void {
  const { transcript } = deps;
  const { eventName, userText, clientContext, startSessionToken, assistantText } = turn;
  // Appended only while the session that started the turn is still running: a turn the user
  // reset away from stays out of the new session's replay.
  if (transcript && (!turn.userHalfOnly || userText !== undefined)) {
    if (transcript.sessionToken() === startSessionToken) {
      if (userText !== undefined) {
        transcript.append({
          role: "user",
          text: userText,
          ts: Date.now(),
          ...(clientContext.trigger.guide ? { guide: clientContext.trigger.guide } : {}),
        });
      }
      if (assistantText) {
        transcript.append({ role: "assistant", text: assistantText, ts: Date.now() });
      }
    } else {
      log.info("transcript_skipped", { reason: "session_reset", event_name: eventName });
    }
  }
  // Ungated on purpose: a capped diagnostic log of what was sent, with no session concept and no replay.
  deps.contextHistory?.append({
    ts: Date.now(),
    event_name: eventName,
    trigger_kind: clientContext.trigger.kind,
    client_context: clientContext,
  });
  try {
    deps.appendTurnRecord?.(
      buildTurnRecord({
        ts: Date.now(),
        event_name: eventName,
        trigger_kind: clientContext.trigger.kind,
        client_context: clientContext,
        spoke_text: turn.spokeText,
      }),
    );
  } catch (err) {
    log.debug("turn_record_append_failed", { error: String(err) });
  }
}
