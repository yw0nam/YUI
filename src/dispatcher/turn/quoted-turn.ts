/**
 * Quoted turn — the admitted user turn the speech bubble quotes, and what was observed of it.
 *
 * A ledger, not an authority: the dispatcher reports admission and failure, speech playback
 * reports the utterance it opened, the turn log reports settlement, and each fact becomes one call
 * on the surfaces. Whether there is a reply is the backend's.
 */
import type { SourceLine, UserQuote } from "../../io/bridge/message/message-bridge";
import { guideKeyOf, userImagesOf, userTextOf } from "../backend/context-builder";
import { userTurnSourceOf } from "../core/classify";
import { sourceLinesOf } from "./signal-lines";
import type { Turn, TurnLog } from "./turn";

/** The surface calls the quote drives; the real Surfaces satisfies it. */
export interface QuoteSurfaces {
  quoteUser(quote: UserQuote): void;
  quoteSignals(lines: SourceLine[]): void;
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
  type Quoted =
    | {
        kind: "user";
        id: number;
        text: string;
        images: string[];
        via: UserQuote["via"];
        guide: boolean;
        spoke: boolean;
      }
    | { kind: "signals"; id: number; lines: SourceLine[]; spoke: boolean };
  let quoted: Quoted | null = null;

  const unsubscribe = deps.turnLog.subscribe((over) => {
    if (!over || quoted === null) return;
    quoted = null;
    surfaces.settleQuote();
  });

  return {
    admitted(turn) {
      const via = userTurnSourceOf(turn.trigger);
      if (via === undefined) {
        const lines = sourceLinesOf(turn.trigger);
        if (lines.length > 0) {
          // Nothing shows until the utterance opens — the quote holds the lines for it.
          quoted = { kind: "signals", id: turn.id, lines, spoke: false };
          return;
        }
        if (quoted === null) return;
        quoted = null;
        surfaces.settleQuote();
        return;
      }
      const text = userTextOf(turn.trigger) ?? "";
      const images = userImagesOf(turn.trigger) ?? [];
      quoted = {
        kind: "user",
        id: turn.id,
        text,
        images,
        via,
        guide: guideKeyOf(turn.trigger) !== undefined,
        spoke: false,
      };
      surfaces.quoteUser({ text, via, images: images.length });
    },
    utteranceStart() {
      if (!quoted) return;
      if (quoted.kind === "signals" && !quoted.spoke) surfaces.quoteSignals(quoted.lines);
      quoted.spoke = true;
    },
    failed(turn) {
      if (quoted?.id !== turn.id) return;
      const failedQuote = quoted;
      quoted = null;
      if (failedQuote.spoke) {
        surfaces.settleQuote();
        return;
      }
      // A signal quote never showed, so there is nothing to clear or restore.
      if (failedQuote.kind === "signals") return;
      // Resending the bare request would lose the guide, so a guide turn restores nothing.
      if (failedQuote.via === "text" && !failedQuote.guide)
        surfaces.restoreInput(failedQuote.text, failedQuote.images);
      surfaces.clearQuote();
    },
    dispose() {
      unsubscribe();
    },
  };
}
