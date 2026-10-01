/**
 * Quoted turn — the admitted user turn the speech bubble quotes, and what was observed of it.
 *
 * A ledger, not an authority: the dispatcher reports admission and failure, speech playback
 * reports the utterance it opened, the turn log reports settlement, and each fact becomes one call
 * on the surfaces. Whether there is a reply is the backend's.
 */
import type { UserQuote } from "../../io/bridge/message-bridge";
import { userImagesOf, userTextOf } from "../backend/context-builder";
import { userTurnSourceOf } from "../core/classify";
import type { Turn, TurnLog } from "./turn";

/** The surface calls the quote drives; the real Surfaces satisfies it. */
export interface QuoteSurfaces {
  quoteUser(quote: UserQuote): void;
  settleQuote(): void;
  clearQuote(): void;
  restoreInput(text: string, images: string[]): void;
}

export interface QuotedTurn {
  /** The dispatcher admitted a turn: a user turn replaces the quote, any other turn settles it. */
  admitted(turn: Turn): void;
  /** Speech playback opened a backend utterance for the current turn. */
  utteranceStart(): void;
  /** The backend call for `turn` settled in a failure. */
  failed(turn: Turn): void;
  dispose(): void;
}

export function createQuotedTurn(deps: {
  surfaces: QuoteSurfaces;
  turnLog: Pick<TurnLog, "subscribe">;
}): QuotedTurn {
  const { surfaces } = deps;
  let quoted: {
    id: number;
    text: string;
    images: string[];
    via: UserQuote["via"];
    spoke: boolean;
  } | null = null;

  const unsubscribe = deps.turnLog.subscribe((over) => {
    if (!over || quoted === null) return;
    quoted = null;
    surfaces.settleQuote();
  });

  return {
    admitted(turn) {
      const via = userTurnSourceOf(turn.trigger);
      if (via === undefined) {
        if (quoted === null) return;
        quoted = null;
        surfaces.settleQuote();
        return;
      }
      const text = userTextOf(turn.trigger) ?? "";
      const images = userImagesOf(turn.trigger) ?? [];
      quoted = { id: turn.id, text, images, via, spoke: false };
      surfaces.quoteUser({ text, via, images: images.length });
    },
    utteranceStart() {
      if (quoted) quoted.spoke = true;
    },
    failed(turn) {
      if (quoted?.id !== turn.id) return;
      const failedQuote = quoted;
      quoted = null;
      if (failedQuote.spoke) {
        surfaces.settleQuote();
        return;
      }
      if (failedQuote.via === "text") surfaces.restoreInput(failedQuote.text, failedQuote.images);
      surfaces.clearQuote();
    },
    dispose() {
      unsubscribe();
    },
  };
}
