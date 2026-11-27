/**
 * Quoted turn — the admitted user turn the speech bubble quotes, and what was observed of it.
 *
 * A ledger, not an authority: the dispatcher reports admission and failure, speech playback
 * reports the utterance it opened, the turn log reports settlement, and each fact becomes one call
 * on the surfaces. Whether there is a reply is the backend's.
 */
import type { AttachedThread } from "../../contract";
import type { SourceLine, UserQuote } from "../../io/bridge/message/message-bridge";
import {
  guideKeyOf,
  threadsAttachedOf,
  userImagesOf,
  userTextOf,
} from "../backend/context-builder";
import { mentionOf, routedViaOf, userTurnSourceOf } from "../core/classify";
import { sourceLinesOf } from "./signal-lines";
import type { Translate } from "./trigger-line";
import type { Turn, TurnLog } from "./turn";

/** The surface calls the quote drives; the real Surfaces satisfies it. */
export interface QuoteSurfaces {
  quoteUser(quote: UserQuote): void;
  quoteSignals(lines: SourceLine[]): void;
  quoteTrigger(text: string): void;
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
  /** Catalogs the fixed trigger-line phrases. */
  translate: Translate;
  /** Puts a failed turn's attached Threads back on the chat input. */
  restoreThreads?: (threads: AttachedThread[]) => void;
}): QuotedTurn {
  const { surfaces } = deps;
  type Quoted =
    | {
        kind: "user";
        id: number;
        text: string;
        images: string[];
        threads: AttachedThread[];
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
      const source = userTurnSourceOf(turn.trigger);
      if (source === undefined) {
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
      const threads = threadsAttachedOf(turn.trigger) ?? [];
      const via = routedViaOf(turn.trigger) ?? source;
      quoted = {
        kind: "user",
        id: turn.id,
        text,
        images,
        threads,
        via,
        guide: guideKeyOf(turn.trigger) !== undefined,
        spoke: false,
      };
      const mention = mentionOf(turn.trigger);
      surfaces.quoteUser({
        text,
        via,
        images: images.length,
        ...(mention ? { mention } : {}),
        ...(threads.length ? { threads: threads.map((t) => t.title) } : {}),
      });
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
      if (failedQuote.threads.length) deps.restoreThreads?.(failedQuote.threads);
      surfaces.clearQuote();
    },
    dispose() {
      unsubscribe();
    },
  };
}
