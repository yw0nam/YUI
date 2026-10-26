/**
 * addressed-producer — the speaking half of the addressed turns.
 *
 * Records which preset a reply was addressed to (via the address_character tool) and, when the
 * dispatcher closes that turn having spoken, emits the character-addressed bridge event the other
 * window's addressed-source turns into a candidate.
 *
 * firing ≠ judgment: this only emits the event; the addressed window's backend decides
 * whether/what to speak.
 */

import type { CharacterAddressed } from "../../../io/bridge/settings-bridge";
import type { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import { createLogger } from "../../../logger";
import type { TurnOutcome } from "../../backend/backend-caller";

const log = createLogger("addressed-producer");

/** Turns whose recipients are kept, so overlapping push turns stay apart. */
const TARGETS_KEPT = 8;

export function createAddressedProducer(deps: {
  /** This window's conversation transcript; the assistant entries with the turn's id are the spoken reply. */
  transcript: Pick<ReturnType<typeof createChatHistoryStore>, "entriesAfterLastBoundary">;
  selfPresetId: string;
  selfName: () => string;
  emit: (event: CharacterAddressed) => void;
  now?: () => number;
}): {
  record(turnId: string, to: string, handoff: boolean): string | undefined;
  /** The preset a still-open turn's reply was addressed to. */
  targetOf(turnId: string): string | undefined;
  /** The dispatcher's onTurnClosed. */
  onTurnClosed(turn: {
    id: number;
    outcome: TurnOutcome;
    spokeText: boolean;
    userText?: string;
  }): void;
} {
  const now = deps.now ?? Date.now;
  const targets = new Map<string, { to: string; handoff: boolean }>();

  return {
    record(turnId, to, handoff) {
      const known = targets.get(turnId);
      if (known !== undefined) return known.to;
      targets.delete(turnId);
      targets.set(turnId, { to, handoff });
      if (targets.size > TARGETS_KEPT) targets.delete(targets.keys().next().value as string);
      return undefined;
    },
    targetOf: (turnId) => targets.get(turnId)?.to,
    onTurnClosed({ id, outcome, spokeText, userText }) {
      const key = String(id);
      const target = targets.get(key);
      if (target === undefined) return;
      const { to, handoff } = target;
      targets.delete(key);
      if (outcome !== "ok" || !spokeText) return;
      const text = deps.transcript
        .entriesAfterLastBoundary()
        .filter((e) => e.role === "assistant" && e.turn_id === key)
        .map((e) => e.text)
        .join(" ");
      if (!text) {
        log.info("no_text", { to });
        return;
      }
      deps.emit({
        from: deps.selfPresetId,
        name: deps.selfName(),
        to,
        text,
        ts: now(),
        ...(handoff && userText ? { user_message: userText } : {}),
      });
      log.info("fire", { to });
    },
  };
}
