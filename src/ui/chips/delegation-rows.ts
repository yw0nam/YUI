/**
 * delegation-rows — the delegation list's shared pieces: relative time text and row rendering.
 *
 * Elapsed and "ago" are computed on the client from the backend's epoch stamps; a visible list
 * re-renders once a minute to keep them current.
 */

import "./delegation-rows.css";
import type { DelegationItem } from "../../io/chat/push-socket";
import { t } from "../i18n";

/** How often a visible delegation list recomputes its elapsed and ago text. */
export const DELEGATION_REFRESH_MS = 60_000;

/** A duration in whole minutes under an hour, hours and minutes above ("4분", "1시간 12분"). */
export function formatDelegationDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return t("deleg.min", { n: minutes });
  return t("deleg.hour_min", { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** One row's right-side text — running elapsed, or done (or failed) with an "ago" stamp. */
export function formatDelegationTime(item: DelegationItem, now: number): string {
  if (item.state === "running") return formatDelegationDuration(now - item.started_at);
  const failed = item.status === "error";
  if (item.ended_at === undefined) return t(failed ? "deleg.failed" : "deleg.done");
  const time = formatDelegationDuration(now - item.ended_at);
  return t(failed ? "deleg.failed_ago" : "deleg.done_ago", { time });
}

/** Running items first, then done; each group keeps the backend's order. */
export function sortDelegations(items: DelegationItem[]): DelegationItem[] {
  return [
    ...items.filter((item) => item.state === "running"),
    ...items.filter((item) => item.state !== "running"),
  ];
}

/** Rebuilds the container's rows from the list, sorted running-first. */
export function renderDelegationRows(
  container: HTMLElement,
  items: DelegationItem[],
  now: number,
): void {
  container.replaceChildren();
  for (const item of sortDelegations(items)) {
    const row = document.createElement("div");
    row.className = "yui-deleg__item";
    row.dataset.state = item.state;
    if (item.status !== undefined) row.dataset.status = item.status;
    const dot = document.createElement("span");
    dot.className = "yui-deleg__item-dot";
    dot.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "yui-deleg__item-title";
    title.textContent = item.title;
    const time = document.createElement("span");
    time.className = "yui-deleg__item-time";
    time.textContent = formatDelegationTime(item, now);
    row.append(dot, title, time);
    container.append(row);
  }
}
