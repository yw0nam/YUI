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
  now: () => number = () => performance.now(),
): Typewriter {
  let raw = "";
  let cursor = 0;
  let ceiling = 0;
  let msPerChar = FIXED_MS_PER_CHAR;
  let paced = false;
  let skip = false;
  let ended = false;
  let stopped = true;
  // The cursor is due at base + elapsed / msPerChar since t0, so a late tick catches up.
  let base = 0;
  let t0 = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const limit = (): number => (paced ? Math.min(ceiling, raw.length) : raw.length);

  function emit(): void {
    onReveal(cursor, { done: ended && cursor === raw.length });
  }

  function catchUp(): void {
    if (stopped) return;
    // The epsilon keeps a tick that fires exactly on time from rounding down to the character before.
    const due = Math.min(limit(), base + Math.floor((now() - t0) / msPerChar + 1e-9));
    if (due <= cursor) return;
    cursor = due;
    emit();
  }

  function schedule(): void {
    if (stopped || timer !== null || cursor >= limit()) return;
    const wait = Math.max(0, t0 + (cursor + 1 - base) * msPerChar - now());
    timer = setTimeout(() => {
      timer = null;
      catchUp();
      schedule();
    }, wait);
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  // The rate changed, or typing resumes from a wait: count on from here, from now.
  function restart(): void {
    clearTimer();
    base = cursor;
    t0 = now();
    schedule();
  }

  function stop(): void {
    clearTimer();
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
      // Text that came back shorter never shows past its end.
      if (cursor > raw.length) {
        cursor = raw.length;
        emit();
      }
      if (!skip) {
        if (timer === null) restart();
        return;
      }
      cursor = raw.length;
      emit();
    },
    pace({ text, durationMs }) {
      if (!paced) return;
      catchUp();
      // Separators the voice skips (a push line's newlines) are passed over; text the voice reads differently is counted by length.
      const at = raw.indexOf(text, ceiling);
      const next = at >= 0 ? at + text.length : ceiling + text.length;
      // Characters an earlier sentence still owes type with this one, so the text keeps up with the voice.
      msPerChar = durationMs === null ? FIXED_MS_PER_CHAR : durationMs / Math.max(1, next - cursor);
      ceiling = next;
      restart();
    },
    end() {
      if (stopped) return;
      ended = true;
      if (cursor === raw.length) emit();
      else schedule();
    },
    flush() {
      if (stopped) return;
      clearTimer();
      skip = true;
      cursor = raw.length;
      emit();
    },
    release() {
      catchUp();
      paced = false;
      msPerChar = FIXED_MS_PER_CHAR;
      restart();
    },
    stop,
  };
}
