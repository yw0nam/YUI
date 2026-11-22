import { getLocale } from "../../i18n";

/** Locale-aware wall-clock time, 24h so the tabular-nums column stays aligned. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Session start: time alone for today, date + time for older days. */
export function formatSessionStart(ts: number, now: number): string {
  const then = new Date(ts);
  const today = new Date(now);
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay) return formatTime(ts);
  const date = then.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
  return `${date} ${formatTime(ts)}`;
}
