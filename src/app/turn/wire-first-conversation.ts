/** After the First conversation page connects: the greeting, then the input, then the controls hint with the guides. */
import type { GuideKey, UtteranceIdentity } from "../../contract";
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
    submitGuide: (guide: GuideKey, text: string) => void;
  },
): { dispose: () => void } {
  let stopWaiting: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const after = (ms: number, then: () => void): void => {
    timer = setTimeout(() => {
      timer = null;
      then();
    }, ms);
  };

  const showHint = (): void => {
    if (!maybeShowFirstRunHint({ ...deps, chatConfigured: true })) return;
    deps.surfaces.showSpeechActions([
      {
        label: deps.t("help.controls.hear"),
        onClick: () => deps.submitGuide("controls", deps.t("help.controls.request")),
      },
      {
        label: deps.t("help.capabilities.hear"),
        onClick: () => deps.submitGuide("capabilities", deps.t("help.capabilities.request")),
      },
    ]);
  };

  const stopWaitingForGreeting = (): void => {
    stopWaiting?.();
    stopWaiting = null;
  };

  const onGreetingEnd = (startedAt: number): void => {
    stopWaitingForGreeting();
    const line = deps.transcript.entriesAfterLastBoundary().findLast((e) => e.greeting);
    const typeMs = (line?.text.length ?? 0) * TYPE_MS_PER_CHAR;
    // With no audio to play, the greeting ends before it typed out.
    after(Math.max(0, typeMs - (Date.now() - startedAt)), () => {
      deps.surfaces.summonInput();
      after(GREETING_READ_MS, () => {
        if (!deps.isBusy()) showHint();
      });
    });
  };

  const stopListening = deps.onFirstConversationConnected(() => {
    if (stopWaiting || timer !== null) return;
    const startedAt = Date.now();
    // Subscribed first: with nothing to play, the greeting ends inside greetLocal.
    stopWaiting = deps.onUtteranceEnd((identity) => {
      if (identity.event_name === "greeting") onGreetingEnd(startedAt);
    });
    if (deps.greetLocal()) return;
    stopWaitingForGreeting();
    // The setup bubble's Connect button has nothing left to do.
    deps.surfaces.hideSpeech();
    deps.surfaces.summonInput();
    showHint();
  });

  return {
    dispose() {
      stopListening();
      stopWaitingForGreeting();
      if (timer !== null) clearTimeout(timer);
    },
  };
}
