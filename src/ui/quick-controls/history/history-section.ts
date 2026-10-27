/**
 * History tab — session accordion over the persisted transcript.
 *
 * Read-only viewer: sessions come from the store newest-first, the current one
 * is expanded by default, and every turn renders as plain text (never markdown).
 */
import "./history-section.css";
import type { ChatSession } from "../../../io/chat/conversation/chat-history-store";
import type { SignalRecord } from "../../../io/chat/conversation/signal-history-store";
import { presetIdForWindow, readPresetName } from "../../../settings/preset/active-preset";
import { getLocale, t } from "../../i18n";
import { renderSourceLine, sourceLineOf } from "../../signals/source-line";
import { HIST_CHEVRON_SVG } from "../constants";
import { type HistoryRow, mergeSessionRows, tsOf } from "./history-rows";

interface HistoryTranscript {
  sessions(): ChatSession[];
  subscribe(cb: () => void): () => void;
}

interface HistorySectionDeps {
  root: HTMLElement;
  transcript: HistoryTranscript;
  /** The signal records shown beside the turns they ran in. */
  signalHistory?: { records(): SignalRecord[]; subscribe(cb: () => void): () => void };
  /** Skip repaints while the panel is closed. */
  isOpen: () => boolean;
}

interface HistorySection {
  render(): void;
  dispose(): void;
}

/** Locale-aware wall-clock time, 24h so the tabular-nums column stays aligned. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Session start: time alone for today, date + time for older days. */
function formatSessionStart(ts: number, now: number): string {
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

export function createHistorySection({
  root,
  transcript,
  signalHistory,
  isOpen,
}: HistorySectionDeps): HistorySection {
  const listEl = root.querySelector<HTMLElement>(".yui-hist");
  // Explicit user toggles; sessions without one follow the default (current session open).
  const toggled = new Map<string, boolean>();

  function keyOf(session: ChatSession, index: number): string {
    return session.startedAt === null ? `empty-${index}` : String(session.startedAt);
  }

  function turnEl(row: HistoryRow): HTMLElement {
    const records = row.kind === "chat" ? row.signals : row.records;
    const isYui = row.kind === "signal" || row.entry.role === "assistant";
    const silent = row.kind === "signal" && row.records[0].said === null;
    const text =
      row.kind === "chat" ? row.entry.text : (row.records[0].said ?? t("history.signal_silent"));
    const el = document.createElement("div");
    el.className = `yui-hist__turn${isYui ? " is-yui" : ""}${row.kind === "signal" ? " is-signal" : ""}`;
    if (records.length > 0) {
      const source = document.createElement("div");
      source.className = "yui-hist__source";
      source.append(...records.map((r) => renderSourceLine(sourceLineOf(r))));
      el.append(source);
    }
    const who = document.createElement("span");
    who.className = "yui-hist__who";
    who.textContent = isYui ? readPresetName(presetIdForWindow()) : t("history.who_user");
    const say = document.createElement("span");
    say.className = silent ? "yui-hist__say is-silent" : "yui-hist__say";
    say.textContent = text;
    const ts = document.createElement("span");
    ts.className = "yui-hist__ts";
    ts.textContent = formatTime(tsOf(row));
    el.append(who, say, ts);
    return el;
  }

  function sessionEl(
    session: ChatSession,
    rows: HistoryRow[],
    index: number,
    now: number,
  ): HTMLElement {
    const key = keyOf(session, index);
    const open = toggled.get(key) ?? index === 0;
    const isCurrent = index === 0;
    const headId = `yui-hist-sess-${key}`;
    const logId = `yui-hist-log-${key}`;

    const group = document.createElement("div");
    group.className = open ? "yui-hist__sess-group is-open" : "yui-hist__sess-group";

    const head = document.createElement("button");
    head.type = "button";
    head.id = headId;
    head.className = open ? "yui-hist__sess is-open" : "yui-hist__sess";
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", logId);
    head.dataset.sessionKey = key;

    const chev = document.createElement("span");
    chev.className = open ? "yui-hist__sess-chev is-open" : "yui-hist__sess-chev";
    chev.innerHTML = HIST_CHEVRON_SVG;

    const main = document.createElement("span");
    main.className = "yui-hist__sess-main";
    const date = document.createElement("span");
    date.className = "yui-hist__sess-date";
    const started = session.startedAt === null ? "" : formatSessionStart(session.startedAt, now);
    date.textContent = isCurrent
      ? started
        ? `${t("history.current")} · ${started}`
        : t("history.current")
      : started;
    main.append(date);
    if (!open) {
      const preview = document.createElement("span");
      preview.className = "yui-hist__sess-preview";
      preview.textContent = session.entries.find((e) => e.role === "user")?.text ?? "";
      main.append(preview);
    }

    const count = document.createElement("span");
    count.className = "yui-hist__sess-count";
    count.textContent =
      rows.length === 1 ? t("history.messages_one") : t("history.messages", { n: rows.length });

    head.append(chev, main, count);
    group.append(head);

    if (open) {
      const log = document.createElement("div");
      log.className = "yui-hist__log";
      log.id = logId;
      log.setAttribute("role", "region");
      log.setAttribute("aria-labelledby", headId);
      if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "yui-hist__empty";
        empty.textContent = t("history.empty");
        log.append(empty);
      } else {
        for (const row of rows) log.append(turnEl(row));
      }
      group.append(log);
    }
    return group;
  }

  function render(): void {
    if (!listEl) return;
    const now = Date.now();
    const sessions = transcript.sessions();
    const rows = mergeSessionRows(sessions, signalHistory?.records() ?? []);
    listEl.replaceChildren(...sessions.map((s, i) => sessionEl(s, rows[i], i, now)));
  }

  function handleClick(e: MouseEvent): void {
    const head = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-hist__sess");
    if (!head || !listEl?.contains(head)) return;
    const key = head.dataset.sessionKey;
    if (key === undefined) return;
    toggled.set(key, head.getAttribute("aria-expanded") !== "true");
    const hadFocus = document.activeElement === head;
    render();
    // The row was rebuilt — keyboard users keep their place on it.
    if (hadFocus) {
      listEl?.querySelector<HTMLButtonElement>(`[data-session-key="${CSS.escape(key)}"]`)?.focus();
    }
  }

  listEl?.addEventListener("click", handleClick);
  const repaint = (): void => {
    if (isOpen()) render();
  };
  const unsubscribe = transcript.subscribe(repaint);
  const unsubscribeSignals = signalHistory?.subscribe(repaint);

  function dispose(): void {
    listEl?.removeEventListener("click", handleClick);
    unsubscribe();
    unsubscribeSignals?.();
  }

  return { render, dispose };
}
