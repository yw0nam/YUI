/** Performs the card's greeting in a pet window when a session reset opens a new conversation. */
import { type GreetingDeps, performGreeting } from "../../io/chat/card/perform-greeting";
import { resolveStorageKey } from "../../settings/preset/preset-keys";

export function wireGreeting(
  deps: GreetingDeps & {
    /** Resets announced by the preset's other windows. */
    onSessionReset: (cb: (presetId: string) => void) => () => void;
    presetId: string;
    stopTurn: () => void;
  },
): { greetLocal: () => void; dispose: () => void } {
  const greetLocal = (): void => performGreeting(deps);
  // A card import leaves the marker; the preset's first boot consumes it.
  try {
    const key = resolveStorageKey("yui.greeting-pending", deps.presetId);
    if (globalThis.localStorage?.getItem(key)) {
      globalThis.localStorage.removeItem(key);
      greetLocal();
    }
  } catch {
    // An unavailable storage skips the imported greeting
  }
  const dispose = deps.onSessionReset((presetId) => {
    if (presetId !== deps.presetId) return;
    deps.stopTurn();
    greetLocal();
  });
  return { greetLocal, dispose };
}
