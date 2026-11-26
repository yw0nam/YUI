/** A card's time left until its deadline, ticking where the shown seconds change so the last tick lands on the deadline. */

import { t } from "../i18n";

/** Writes the time left into `timer` and calls `onTick` with the seconds shown; hides `timer` without a deadline. Returns the stop. */
export function countdown(
  timer: HTMLElement,
  expiresAt: number | undefined,
  onTick: (seconds: number) => void,
): () => void {
  timer.hidden = expiresAt === undefined;
  if (expiresAt === undefined) return () => {};
  let tick: ReturnType<typeof setTimeout> | undefined;
  const step = (): void => {
    const left = expiresAt - Date.now();
    const s = Math.max(0, Math.ceil(left / 1000));
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    timer.textContent = t("ask.time_left", { time });
    onTick(s);
    if (left > 0) tick = setTimeout(step, left - (s - 1) * 1000);
  };
  step();
  return () => clearTimeout(tick);
}
