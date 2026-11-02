/** After the First conversation page connects: the greeting, then the input and the controls hint. */
import type { UtteranceIdentity } from "../../contract";
import { type FirstRunHintDeps, maybeShowFirstRunHint } from "../../ui/notices/first-run-hint";

export function wireFirstConversation(
  deps: Omit<FirstRunHintDeps, "chatConfigured" | "surfaces"> & {
    surfaces: FirstRunHintDeps["surfaces"] & { summonInput(): void };
    onFirstConversationConnected: (cb: () => void) => () => void;
    onUtteranceEnd: (cb: (identity: UtteranceIdentity) => void) => () => void;
    greetLocal: () => boolean;
  },
): { dispose: () => void } {
  let stopWaiting: (() => void) | null = null;

  const finish = (): void => {
    stopWaiting?.();
    stopWaiting = null;
    deps.surfaces.summonInput();
    maybeShowFirstRunHint({ ...deps, chatConfigured: true });
  };

  const stopListening = deps.onFirstConversationConnected(() => {
    if (stopWaiting) return;
    // Subscribed first: with nothing to play, the greeting ends inside greetLocal.
    stopWaiting = deps.onUtteranceEnd((identity) => {
      if (identity.turn_id.startsWith("greeting:")) finish();
    });
    if (!deps.greetLocal()) finish();
  });

  return {
    dispose() {
      stopListening();
      stopWaiting?.();
    },
  };
}
