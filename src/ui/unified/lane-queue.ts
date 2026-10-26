/**
 * The unified box's lanes — one per open character, holding the bubble ops that character sent in
 * order, exactly as its own bubble would have received them. One lane holds the box at a time; the
 * others buffer. A lane holds the box from its first op that shows something until its line is
 * done, and then the lane that began next replays what it buffered.
 */

import { applySpeechOp, type SpeechOp } from "../surfaces/apply-speech-op";

type Box = Parameters<typeof applySpeechOp>[1];

const SHOWS = new Set<SpeechOp["op"]>(["begin", "quote", "quote-signals"]);

export interface LaneQueue {
  /** One bubble op a character's window sent. */
  accept(preset: string, op: SpeechOp): void;
  /** The box shows all of its current line. */
  allShown(): void;
  /** The box showed, or hid (its own dismiss, its dwell). */
  boxShown(shown: boolean): void;
  /** The open characters; a lane outside them is dropped. */
  setCast(ids: readonly string[]): void;
  /** Drops every lane and hides the box. */
  stopAll(): void;
  /** The character whose line holds the box and is not done, or null. */
  speaker(): string | null;
  /** Whether a character's line waits for the box. */
  waiting(preset: string): boolean;
  /** Fires with the speaker each time the lanes change. */
  onSpeaker(cb: (preset: string | null) => void): () => void;
}

export function createLaneQueue(deps: { box: Box }): LaneQueue {
  const { box } = deps;
  // Waiting lanes in the order their first showing op arrived, each with its buffered ops.
  const waiting = new Map<string, SpeechOp[]>();
  const listeners = new Set<(preset: string | null) => void>();
  // The lane the box shows; it stays the holder once done, until another lane takes the box.
  let holder: string | null = null;
  let done = true;
  // The holder's line: ended (end, or finish after a deferred end), shown whole, a quote with no line yet, a quote holding the box.
  let ended = false;
  let deferred = false;
  let shownWhole = false;
  let quoteOnly = false;
  let quoteHeld = false;
  // Box callbacks fired while an op is applied wait for the op to finish.
  let applying = false;

  const speaker = (): string | null => (done ? null : holder);
  let lastSpeaker: string | null = null;
  function notify(): void {
    const now = speaker();
    if (now === lastSpeaker) return;
    lastSpeaker = now;
    for (const cb of [...listeners]) cb(now);
  }

  function draw(op: SpeechOp): void {
    applying = true;
    try {
      applySpeechOp(op, box);
    } finally {
      applying = false;
    }
  }

  // The holder's own op: it updates the line's state and draws.
  function feed(op: SpeechOp): void {
    switch (op.op) {
      case "begin":
        done = false;
        ended = false;
        deferred = false;
        shownWhole = false;
        quoteOnly = false;
        break;
      case "quote":
      case "quote-signals":
        done = false;
        ended = false;
        shownWhole = false;
        quoteOnly = true;
        if (op.op === "quote") quoteHeld = true;
        break;
      case "end":
        deferred = op.defer === true;
        ended = !deferred;
        break;
      case "finish":
        if (deferred) ended = true;
        break;
      case "settle-quote":
      case "clear-quote":
        quoteHeld = false;
        if (quoteOnly) done = true;
        quoteOnly = false;
        break;
      case "hide":
        done = true;
        break;
    }
    draw(op);
    if (ended && shownWhole) done = true;
  }

  // The next waiting lane takes a box whose holder is done, and replays what it buffered.
  function handOn(): void {
    while (done) {
      const next = waiting.entries().next();
      if (next.done) break;
      const [preset, ops] = next.value;
      waiting.delete(preset);
      if (quoteHeld) draw({ op: "clear-quote" });
      quoteHeld = false;
      holder = preset;
      for (const op of ops) feed(op);
    }
    notify();
  }

  return {
    accept(preset, op) {
      if (preset === holder) {
        feed(op);
      } else {
        const buffered = waiting.get(preset);
        if (buffered) buffered.push(op);
        else if (SHOWS.has(op.op)) waiting.set(preset, [op]);
        // A lane with nothing waiting has no line to hold an op that shows nothing.
      }
      handOn();
    },
    allShown() {
      // Only the line's end makes "all of it" final.
      if (!ended && !deferred) return;
      shownWhole = true;
      if (ended) done = true;
      if (!applying) handOn();
    },
    boxShown(shown) {
      if (shown) return;
      done = true;
      if (!applying) handOn();
    },
    setCast(ids) {
      for (const preset of [...waiting.keys()]) if (!ids.includes(preset)) waiting.delete(preset);
      if (holder !== null && !ids.includes(holder)) {
        holder = null;
        done = true;
        quoteHeld = false;
        draw({ op: "hide" });
      }
      handOn();
    },
    stopAll() {
      waiting.clear();
      holder = null;
      done = true;
      quoteHeld = false;
      draw({ op: "hide" });
      notify();
    },
    speaker,
    waiting: (preset) => waiting.has(preset),
    onSpeaker(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
