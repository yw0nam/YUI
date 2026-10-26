/** Reveal cursor for one line of speech: how many received characters show, typed at a fixed rate or paced by each sentence's audio. */

import type { SentenceStart } from "../../io/voice/tts/tts-pipeline";

const FIXED_MS_PER_CHAR = 40;

export interface Typewriter {
  /** Starts a line; a paced line types each sentence only once its audio starts. */
  begin(opts: { paced: boolean }): void;
  /** The line's whole text so far. */
  received(text: string): void;
  /** A sentence's audio started: type up to that sentence's end over its duration. */
  pace(sentence: SentenceStart): void;
  /** No more text comes for this line. */
  end(): void;
  /** Shows everything received, and the rest of the line as it arrives. */
  flush(): void;
  /** No more audio comes: the rest of the line types at the fixed rate. */
  release(): void;
  /** Drops the line: nothing reveals again until the next begin. */
  stop(): void;
}

export function createTypewriter(
  onReveal: (revealed: number, state: { done: boolean }) => void,
): Typewriter {
  let raw = "";
  let cursor = 0;
  let ceiling = 0;
  let msPerChar = FIXED_MS_PER_CHAR;
  let paced = false;
  let skip = false;
  let ended = false;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const limit = (): number => (paced ? Math.min(ceiling, raw.length) : raw.length);

  function emit(): void {
    onReveal(cursor, { done: ended && cursor === raw.length });
  }

  function schedule(): void {
    if (stopped || timer !== null || cursor >= limit()) return;
    timer = setTimeout(() => {
      timer = null;
      cursor++;
      emit();
      schedule();
    }, msPerChar);
  }

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    stopped = true;
  }

  return {
    begin(opts) {
      stop();
      raw = "";
      cursor = 0;
      ceiling = 0;
      msPerChar = FIXED_MS_PER_CHAR;
      paced = opts.paced;
      skip = false;
      ended = false;
      stopped = false;
    },
    received(text) {
      if (stopped) return;
      raw = text;
      if (!skip) {
        schedule();
        return;
      }
      cursor = raw.length;
      emit();
    },
    pace({ text, durationMs }) {
      if (!paced) return;
      // Separators the voice skips (a push line's newlines) are passed over; text the voice reads differently is counted by length.
      const at = raw.indexOf(text, ceiling);
      const next = at >= 0 ? at + text.length : ceiling + text.length;
      // Characters an earlier sentence still owes type with this one, so the text keeps up with the voice.
      msPerChar = durationMs === null ? FIXED_MS_PER_CHAR : durationMs / Math.max(1, next - cursor);
      ceiling = next;
      schedule();
    },
    end() {
      if (stopped) return;
      ended = true;
      if (cursor === raw.length) emit();
      else schedule();
    },
    flush() {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      skip = true;
      cursor = raw.length;
      emit();
    },
    release() {
      paced = false;
      msPerChar = FIXED_MS_PER_CHAR;
      schedule();
    },
    stop,
  };
}
