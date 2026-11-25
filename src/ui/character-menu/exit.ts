/** One exit transition at a time: done once each element's opacity transition ends, or its duration passes. */

/** Past the longest transition, in case its transitionend never comes. */
const MARGIN_MS = 50;

const toMs = (value: string): number => {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith("ms") ? n : n * 1000;
};

const longestMs = (els: readonly Element[]): number =>
  Math.max(0, ...els.flatMap((el) => getComputedStyle(el).transitionDuration.split(",").map(toMs)));

export function createExit(): {
  /** Waits for `els` to finish their exit, then calls `done`; replaces an exit still running. */
  run(els: readonly Element[], done: () => void): void;
  /** Drops the running exit: its `done` never runs. */
  cancel(): void;
} {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let off = (): void => {};

  function cancel(): void {
    generation++;
    clearTimeout(timer);
    off();
    off = () => {};
  }

  function run(els: readonly Element[], done: () => void): void {
    cancel();
    const current = generation;
    const waiting = new Set<EventTarget>(els);
    const finish = (): void => {
      if (current !== generation) return;
      cancel();
      done();
    };
    const onEnd = (e: Event): void => {
      if (current !== generation || (e as TransitionEvent).propertyName !== "opacity") return;
      if (e.target && waiting.delete(e.target) && waiting.size === 0) finish();
    };
    for (const el of els) el.addEventListener("transitionend", onEnd);
    off = () => {
      for (const el of els) el.removeEventListener("transitionend", onEnd);
    };
    timer = setTimeout(finish, longestMs(els) + MARGIN_MS);
  }

  return { run, cancel };
}
