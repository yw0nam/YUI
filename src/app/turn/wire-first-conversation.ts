/** After the First conversation page connects: the greeting, then the input, then the controls hint. */
import type { UtteranceIdentity } from "../../contract";
import type { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { TYPE_MS_PER_CHAR } from "../../ui/message/typewriter";
import { type FirstRunHintDeps, maybeShowFirstRunHint } from "../../ui/notices/first-run-hint";

/** How long a greeting stays up once it typed out, before the controls hint replaces it. */
const GREETING_READ_MS = 2500;

export function wireFirstConversation(
  deps: Omit<FirstRunHintDeps, "chatConfigured" | "surfaces"> & {
    surfaces: FirstRunHintDeps["surfaces"] & { summonInput(): void };
    onFirstConversationConnected: (cb: () => void) => () => void;
    onUtteranceEnd: (cb: (identity: UtteranceIdentity) => void) => () => void;
    greetLocal: () => boolean;
    transcript: Pick<ReturnType<typeof createChatHistoryStore>, "entriesAfterLastBoundary">;
    /** A turn is running, so the hint would overwrite its reply. */
    isBusy: () => boolean;
  },
): { dispose: () => void } {
  let stopWaiting: (() => void) | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  const showHint = (): void => void maybeShowFirstRunHint({ ...deps, chatConfigured: true });

  const stopWaitingForGreeting = (): void => {
    stopWaiting?.();
    stopWaiting = null;
  };

  const onGreetingEnd = (): void => {
    stopWaitingForGreeting();
    deps.surfaces.summonInput();
    const line = deps.transcript.entriesAfterLastBoundary().findLast((e) => e.greeting);
    hintTimer = setTimeout(
      () => {
        hintTimer = null;
        if (!deps.isBusy()) showHint();
      },
      (line?.text.length ?? 0) * TYPE_MS_PER_CHAR + GREETING_READ_MS,
    );
  };

  const stopListening = deps.onFirstConversationConnected(() => {
    if (stopWaiting || hintTimer !== null) return;
    // Subscribed first: with nothing to play, the greeting ends inside greetLocal.
    stopWaiting = deps.onUtteranceEnd((identity) => {
      if (identity.event_name === "greeting") onGreetingEnd();
    });
    if (deps.greetLocal()) return;
    stopWaitingForGreeting();
    deps.surfaces.summonInput();
    showHint();
  });

  return {
    dispose() {
      stopListening();
      stopWaitingForGreeting();
      if (hintTimer !== null) clearTimeout(hintTimer);
    },
  };
}
