/**
 * delegation-rows — the delegation list's shared pieces: relative time text and row rendering.
 *
 * Elapsed and "ago" are computed on the client from the backend's epoch stamps; a visible list
 * re-renders once a minute to keep them current.
 */

import "./delegation-rows.css";
import type { DelegationItem } from "../../io/chat/push-socket";
import { t } from "../i18n";
import { HIST_CHEVRON_SVG } from "../quick-controls/constants";

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

/** A list that opens a finished item's summary under its row: the ids open now, and what to call after a toggle. */
export interface SummaryDisclosure {
  open: Set<string>;
  onToggle(): void;
}

/** One row's dot, title, and time — the children both the plain row and the disclosure button share. */
function rowParts(item: DelegationItem, now: number): HTMLElement[] {
  const dot = document.createElement("span");
  dot.className = "yui-deleg__item-dot";
  dot.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "yui-deleg__item-title";
  title.textContent = item.title;
  const time = document.createElement("span");
  time.className = "yui-deleg__item-time";
  time.textContent = formatDelegationTime(item, now);
  return [dot, title, time];
}

/** The opened panel under a toggle row: the worker's summary and how long the work took. */
function summaryPanel(item: DelegationItem, n: number): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "yui-deleg__summary";
  panel.id = `yui-deleg-sum-${n}`;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", `yui-deleg-row-${n}`);
  const text = document.createElement("p");
  text.className = "yui-deleg__summary-text";
  text.textContent = item.summary ?? "";
  panel.append(text);
  if (item.ended_at !== undefined) {
    const meta = document.createElement("p");
    meta.className = "yui-deleg__summary-meta";
    meta.textContent = t("deleg.took", {
      time: formatDelegationDuration(item.ended_at - item.started_at),
    });
    panel.append(meta);
  }
  return panel;
}

/** Rebuilds the container's rows from the list, sorted running-first. */
export function renderDelegationRows(
  container: HTMLElement,
  items: DelegationItem[],
  now: number,
  disclosure?: SummaryDisclosure,
): void {
  const focused = container.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.id
    : undefined;
  container.replaceChildren();
  sortDelegations(items).forEach((item, n) => {
    const openable =
      disclosure !== undefined &&
      item.state === "done" &&
      typeof item.summary === "string" &&
      item.summary !== "";
    const row = document.createElement(openable ? "button" : "div");
    row.className = openable ? "yui-deleg__item yui-deleg__item--toggle" : "yui-deleg__item";
    row.dataset.id = item.id;
    row.dataset.state = item.state;
    if (item.status !== undefined) row.dataset.status = item.status;
    row.append(...rowParts(item, now));
    if (!openable || !disclosure) {
      container.append(row);
      return;
    }
    const button = row as HTMLButtonElement;
    button.type = "button";
    button.id = `yui-deleg-row-${n}`;
    button.setAttribute("aria-expanded", String(disclosure.open.has(item.id)));
    button.setAttribute("aria-controls", `yui-deleg-sum-${n}`);
    if (disclosure.open.has(item.id)) button.classList.add("is-open");
    const chev = document.createElement("span");
    chev.className = "yui-deleg__item-chev";
    chev.innerHTML = HIST_CHEVRON_SVG;
    button.append(chev);
    button.addEventListener("click", () => {
      if (disclosure.open.has(item.id)) disclosure.open.delete(item.id);
      else disclosure.open.add(item.id);
      disclosure.onToggle();
    });
    container.append(button);
    if (disclosure.open.has(item.id)) container.append(summaryPanel(item, n));
  });
  if (focused === undefined) return;
  for (const el of container.querySelectorAll<HTMLElement>("button.yui-deleg__item")) {
    if (el.dataset.id === focused) {
      el.focus();
      break;
    }
  }
}
