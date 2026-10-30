/** "3 min. ago" in the UI language, from epoch ms; under a minute reads "just now". */

import { getLocale, t } from "../../i18n";

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(at: number, now: number): string {
  const ago = now - at;
  const step = STEPS.find(([, ms]) => ago >= ms);
  if (!step) return t("threads.just_now");
  const [unit, ms] = step;
  return new Intl.RelativeTimeFormat(getLocale(), { style: "short" }).format(
    -Math.floor(ago / ms),
    unit,
  );
}

/** A `<time>` reading `relativeTime(at, now)`, which `refreshTimes` redraws. */
export function timeEl(at: number, now: number): HTMLTimeElement {
  const el = document.createElement("time");
  el.dataset.at = String(at);
  el.textContent = relativeTime(at, now);
  return el;
}

/** Redraws every `timeEl` under `root` and nothing else. */
export function refreshTimes(root: ParentNode, now: number): void {
  for (const el of root.querySelectorAll<HTMLElement>("time[data-at]")) {
    el.textContent = relativeTime(Number(el.dataset.at), now);
  }
}
