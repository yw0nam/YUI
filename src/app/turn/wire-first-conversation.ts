/** After Quick start connects, and on a replay of it: the greeting, then the input, then the controls hint with the guides. */
import type { GuideKey, UtteranceIdentity } from "../../contract";
import type { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { TYPE_MS_PER_CHAR } from "../../ui/message/typewriter";
import { type FirstRunHintDeps, maybeShowFirstRunHint } from "../../ui/notices/first-run-hint";
import { GUIDES } from "../../ui/quick-controls/sections/help/help-section";

/** How long a greeting stays up once it typed out, before the controls hint replaces it. */
const GREETING_READ_MS = 2500;

export function wireFirstConversation(
  deps: Omit<FirstRunHintDeps, "chatConfigured" | "surfaces"> & {
    surfaces: FirstRunHintDeps["surfaces"] & { summonInput(): void };
    onFirstConversationConnected: (cb: () => void) => () => void;
    onFirstConversationReplay: (cb: () => void) => () => void;
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

  const showHint = (replay: boolean): void => {
    // A replay asks for the hint again, whatever the seen flag says.
    const shown = replay
      ? maybeShowFirstRunHint({ ...deps, chatConfigured: true, seen: () => false })
      : maybeShowFirstRunHint({ ...deps, chatConfigured: true });
    if (!shown) return;
    deps.surfaces.showSpeechActions(
      GUIDES.map((guide) => ({
        label: deps.t(`help.${guide}.hear`),
        // A reply bound for the unified window replaces nothing here, so the press drops the hint itself.
        onClick: () => {
          deps.surfaces.hideSpeech();
          deps.submitGuide(guide, deps.t(`help.${guide}.request`));
        },
      })),
    );
  };

  const stopWaitingForGreeting = (): void => {
    stopWaiting?.();
    stopWaiting = null;
  };

  const onGreetingEnd = (startedAt: number, replay: boolean): void => {
    stopWaitingForGreeting();
    const line = deps.transcript.entriesAfterLastBoundary().findLast((e) => e.greeting);
    const typeMs = (line?.text.length ?? 0) * TYPE_MS_PER_CHAR;
    // With no audio to play, the greeting ends before it typed out.
    after(Math.max(0, typeMs - (Date.now() - startedAt)), () => {
      deps.surfaces.summonInput();
      after(GREETING_READ_MS, () => {
        if (!deps.isBusy()) showHint(replay);
      });
    });
  };

  const run = (opts: { replay: boolean }): void => {
    if (stopWaiting || timer !== null) return;
    // A turn runs, so the replay would overwrite its reply.
    if (opts.replay && deps.isBusy()) return;
    const startedAt = Date.now();
    // Subscribed first: with nothing to play, the greeting ends inside greetLocal.
    stopWaiting = deps.onUtteranceEnd((identity) => {
      if (identity.event_name === "greeting") onGreetingEnd(startedAt, opts.replay);
    });
    if (deps.greetLocal()) return;
    stopWaitingForGreeting();
    // The setup bubble's Connect button has nothing left to do.
    deps.surfaces.hideSpeech();
    deps.surfaces.summonInput();
    showHint(opts.replay);
  };

  const stopListening = deps.onFirstConversationConnected(() => run({ replay: false }));
  const stopListeningReplay = deps.onFirstConversationReplay(() => run({ replay: true }));

  return {
    dispose() {
      stopListening();
      stopListeningReplay();
      stopWaitingForGreeting();
      if (timer !== null) clearTimeout(timer);
    },
  };
}
