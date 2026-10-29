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
