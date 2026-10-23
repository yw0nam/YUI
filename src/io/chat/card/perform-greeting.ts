import type { Card } from "../../../config/validators/persona/types";
import type { UtteranceIdentity } from "../../../contract";
import type { createChatHistoryStore } from "../conversation/chat-history-store";
import { substituteMacros } from "./assemble-card";
import { pickGreeting } from "./pick-greeting";

export interface GreetingDeps {
  transcript: Pick<
    ReturnType<typeof createChatHistoryStore>,
    "reloadFromStorage" | "entriesAfterLastBoundary" | "append"
  >;
  /** The card this window sends; null means no greeting. */
  getCard: () => { card: Card; charName: string } | null;
  userName: () => string;
  speak: (text: string, identity: UtteranceIdentity) => void;
  now?: () => number;
  random?: () => number;
}

/** Performs one of the card's greetings and records it, when the running session is empty. */
export function performGreeting(deps: GreetingDeps): void {
  const { transcript, now = Date.now, random = Math.random } = deps;
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
