import type { MessageSurfaceOp } from "../../io/bridge/message/message-bridge";
import type { Surfaces } from "./surfaces";

/** The message ops that draw the bubble: the line and the quoted turn. */
export type SpeechOp = Extract<
  MessageSurfaceOp,
  {
    op:
      | "begin"
      | "push"
      | "end"
      | "finish"
      | "hide"
      | "quote"
      | "quote-signals"
      | "settle-quote"
      | "clear-quote";
  }
>;

/** Draws one bubble op on the surfaces, as the pet window's own bubble would have drawn it. */
export function applySpeechOp(
  op: SpeechOp,
  surfaces: Pick<
    Surfaces,
    | "beginSpeech"
    | "pushSpeech"
    | "endSpeech"
    | "finishSpeech"
    | "hideSpeech"
    | "quoteUser"
    | "quoteSignals"
    | "settleQuote"
    | "clearQuote"
  >,
): void {
  switch (op.op) {
    case "begin":
      surfaces.beginSpeech();
      break;
    case "push":
      surfaces.pushSpeech(op.delta);
      break;
    case "end":
      surfaces.endSpeech(op.defer ? { defer: true } : undefined);
      break;
    case "finish":
      surfaces.finishSpeech();
      break;
    case "hide":
      surfaces.hideSpeech();
      break;
    case "quote":
      surfaces.quoteUser(op.quote);
      break;
    case "quote-signals":
      surfaces.quoteSignals(op.lines);
      break;
    case "settle-quote":
      surfaces.settleQuote();
      break;
    case "clear-quote":
      surfaces.clearQuote();
      break;
    default: {
      const unhandled: never = op;
      void unhandled;
    }
  }
}
