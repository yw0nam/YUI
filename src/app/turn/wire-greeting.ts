/** Performs the card's greeting in a pet window when a session reset opens a new conversation. */
import type { Card } from "../../config/validators/persona/types";
import type { UtteranceIdentity } from "../../contract";
import { substituteMacros } from "../../io/chat/card/assemble-card";
import { pickGreeting } from "../../io/chat/card/pick-greeting";
import type { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";

type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;

export function wireGreeting(deps: {
  /** Resets announced by the preset's other windows. */
  onSessionReset: (cb: (presetId: string) => void) => () => void;
  presetId: string;
  stopTurn: () => void;
  transcript: Pick<ChatHistoryStore, "reloadFromStorage" | "entriesAfterLastBoundary" | "append">;
  /** The card this window sends; null means no greeting. */
  getCard: () => { card: Card; charName: string } | null;
  userName: () => string;
  speak: (text: string, identity: UtteranceIdentity) => void;
  now?: () => number;
  random?: () => number;
}): { greetLocal: () => void; dispose: () => void } {
  const { transcript, now = Date.now, random = Math.random } = deps;

  function greetLocal(): void {
    // Another window's reset reaches this store only through storage.
    transcript.reloadFromStorage();
    if (transcript.entriesAfterLastBoundary().length > 0) return;
    const resolved = deps.getCard();
    if (!resolved) return;
    const raw = pickGreeting(resolved.card, random);
    if (raw === null) return;
    const text = substituteMacros(raw, {
      charName: resolved.charName,
      userName: deps.userName(),
      original: "",
    });
    const ts = now();
    transcript.append({ role: "assistant", text, ts, greeting: true });
    deps.speak(text, { turn_id: `greeting:${ts}`, event_name: "greeting" });
  }

  const dispose = deps.onSessionReset((presetId) => {
    if (presetId !== deps.presetId) return;
    deps.stopTurn();
    greetLocal();
  });
  return { greetLocal, dispose };
}

/** What a window's "Start fresh" announces: the bridge event, then this pet window's own greeting once bound. */
export function createSessionResetAnnouncer(emit: (presetId: string) => void, presetId: string) {
  let greetLocal = (): void => {};
  return {
    announce(): void {
      emit(presetId);
      greetLocal();
    },
    bindGreeting(greet: () => void): void {
      greetLocal = greet;
    },
  };
}
