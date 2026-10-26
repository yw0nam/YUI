/** Start fresh — the one path the History page and the quick card reset the conversation by. */

import type { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import type { createSessionDiagnosticsStore } from "../../../io/chat/conversation/session-diagnostics";
import type { createSessionStore } from "../../../io/chat/conversation/session-store";
import type { Logger } from "../../../logger";

/**
 * Closes the running conversation: the id pointer and diagnostics reset, the transcript keeps
 * its turns behind a session boundary so the History page can still read them.
 */
export function resetConversation(deps: {
  transcript: Pick<ReturnType<typeof createChatHistoryStore>, "startNewSession">;
  sessionStore?: Pick<ReturnType<typeof createSessionStore>, "clear">;
  sessionDiagnostics?: Pick<ReturnType<typeof createSessionDiagnosticsStore>, "clear">;
  /** Stops the in-flight turn the way the stop button does, before the reset frame goes out. */
  stopTurn?: () => void;
  /** Tells the preset's other windows, and this window's greeting, that a new session opened. */
  announceSessionReset?: () => void;
  /** Given on push, which keeps the conversation on the backend: it ends only when the frame lands. */
  push?: { sendReset(): boolean };
  log: Logger;
}): void {
  deps.stopTurn?.();
  deps.sessionStore?.clear();
  deps.sessionDiagnostics?.clear();
  deps.transcript.startNewSession();
  deps.announceSessionReset?.();
  deps.push?.sendReset();
  deps.log.info("session_reset");
}
