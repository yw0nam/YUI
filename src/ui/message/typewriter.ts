/** Reveal cursor for one line of speech: how many received characters show, typed at 40 ms per character. */

export const TYPE_MS_PER_CHAR = 40;

export interface Typewriter {
  /** Starts a line. */
  begin(): void;
  /** The line's whole text so far. */
  received(text: string): void;
  /** No more text comes for this line. */
  end(): void;
  /** Shows everything received, and the rest of the line as it arrives. */
  flush(): void;
  /** Drops the line: nothing reveals again until the next begin. */
  stop(): void;
}

export function createTypewriter(
  onReveal: (revealed: number, state: { done: boolean }) => void,
  now: () => number = () => performance.now(),
): Typewriter {
  let raw = "";
  let cursor = 0;
  let skip = false;
  let ended = false;
  let stopped = true;
  // The cursor is due at base + elapsed / TYPE_MS_PER_CHAR since t0, so a late tick catches up.
  let base = 0;
  let t0 = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function emit(): void {
    onReveal(cursor, { done: ended && cursor === raw.length });
  }

  function catchUp(): void {
    if (stopped) return;
    // The epsilon keeps a tick that fires exactly on time from rounding down to the character before.
    const due = Math.min(raw.length, base + Math.floor((now() - t0) / TYPE_MS_PER_CHAR + 1e-9));
    if (due <= cursor) return;
    cursor = due;
    emit();
  }

  function schedule(): void {
    if (stopped || timer !== null || cursor >= raw.length) return;
    const wait = Math.max(0, t0 + (cursor + 1 - base) * TYPE_MS_PER_CHAR - now());
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

  // Typing resumes from a wait: count on from here, from now.
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
    begin() {
      stop();
      raw = "";
      cursor = 0;
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
    stop,
  };
}
