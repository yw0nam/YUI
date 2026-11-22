/** The History session accordion over the persisted transcript: newest first, the running session open by default. */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  type ChatSession,
  projectSessions,
} from "../../../io/chat/conversation/chat-history-store";
import { t } from "../../i18n";
import { HIST_CHEVRON_SVG } from "../constants";
import "./history-section.css";
import type { HistoryPorts } from "./history-ports";
import { type HistoryRow, mergeSessionRows } from "./history-rows";
import { formatSessionStart } from "./history-time";
import { TurnRow } from "./turn-row";

const keyOf = (session: ChatSession, index: number): string =>
  session.startedAt === null ? `empty-${index}` : String(session.startedAt);

function SessionGroup({
  session,
  rows,
  index,
  open,
  now,
  name,
  onToggle,
}: {
  session: ChatSession;
  rows: HistoryRow[];
  index: number;
  open: boolean;
  now: number;
  name: string;
  onToggle(): void;
}) {
  const key = keyOf(session, index);
  const headId = `yui-hist-sess-${key}`;
  const logId = `yui-hist-log-${key}`;
  const started = session.startedAt === null ? "" : formatSessionStart(session.startedAt, now);
  const date =
    index === 0
      ? started
        ? `${t("history.current")} · ${started}`
        : t("history.current")
      : started;
  return (
    <div className={open ? "yui-hist__sess-group is-open" : "yui-hist__sess-group"}>
      <button
        type="button"
        id={headId}
        className={open ? "yui-hist__sess is-open" : "yui-hist__sess"}
        aria-expanded={open}
        aria-controls={logId}
        data-session-key={key}
        onClick={onToggle}
      >
        <span
          className={open ? "yui-hist__sess-chev is-open" : "yui-hist__sess-chev"}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
          dangerouslySetInnerHTML={{ __html: HIST_CHEVRON_SVG }}
        />
        <span className="yui-hist__sess-main">
          <span className="yui-hist__sess-date">{date}</span>
          {!open && (
            <span className="yui-hist__sess-preview">
              {session.entries.find((e) => e.role === "user")?.text ?? ""}
            </span>
          )}
        </span>
        <span className="yui-hist__sess-count">
          {rows.length === 1
            ? t("history.messages_one")
            : t("history.messages", { n: rows.length })}
        </span>
      </button>
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: the log keeps its div and explicit region role
        <div className="yui-hist__log" id={logId} role="region" aria-labelledby={headId}>
          {rows.length === 0 ? (
            <p className="yui-hist__empty">{t("history.empty")}</p>
          ) : (
            rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: turns carry no id and a log only grows at its end
              <TurnRow key={i} row={row} name={name} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SessionList({
  ports,
  characterName,
}: {
  ports: Pick<HistoryPorts, "transcript" | "signals">;
  /** The name the character's lines go under; read on every render. */
  characterName(): string;
}) {
  const items = useSyncExternalStore(ports.transcript.subscribe, ports.transcript.read);
  const records = useSyncExternalStore(ports.signals.subscribe, ports.signals.read);
  const sessions = useMemo(() => projectSessions(items), [items]);
  const rows = useMemo(() => mergeSessionRows(sessions, records), [sessions, records]);
  // Explicit user toggles; sessions without one follow the default (the running session open).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const now = Date.now();
  const name = characterName();
  return (
    <div className="yui-group yui-hist">
      {sessions.map((session, index) => {
        const key = keyOf(session, index);
        const open = toggled[key] ?? index === 0;
        return (
          <SessionGroup
            key={key}
            session={session}
            rows={rows[index]}
            index={index}
            open={open}
            now={now}
            name={name}
            onToggle={() => setToggled((prev) => ({ ...prev, [key]: !open }))}
          />
        );
      })}
    </div>
  );
}
