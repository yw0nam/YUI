/** Performs the card's greeting in a pet window when a session reset opens a new conversation. */
import { type GreetingDeps, performGreeting } from "../../io/chat/card/perform-greeting";

export function wireGreeting(
  deps: GreetingDeps & {
    /** Resets announced by the preset's other windows. */
    onSessionReset: (cb: (presetId: string) => void) => () => void;
    presetId: string;
    stopTurn: () => void;
  },
): { greetLocal: () => void; dispose: () => void } {
  const greetLocal = (): void => performGreeting(deps);
  const dispose = deps.onSessionReset((presetId) => {
    if (presetId !== deps.presetId) return;
    deps.stopTurn();
    greetLocal();
  });
  return { greetLocal, dispose };
}
