/** One turn of a History session: who spoke, what was said, when, and the source lines of the signals that ran in it. */

import { useLayoutEffect, useRef } from "react";
import type { SignalRecord } from "../../../io/chat/conversation/signal-history-store";
import { t } from "../../i18n";
import { renderSourceLine, sourceLineOf } from "../../signals/source-line";
import { type HistoryRow, tsOf } from "./history-rows";
import { formatTime } from "./history-time";

function SourceLines({ records }: { records: readonly SignalRecord[] }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => host.current?.replaceChildren(...records.map((r) => renderSourceLine(sourceLineOf(r)))),
    [records],
  );
  return <div className="yui-hist__source" ref={host} />;
}

export function TurnRow({ row, name }: { row: HistoryRow; name: string }) {
  const records = row.kind === "chat" ? row.signals : row.records;
  const isYui = row.kind === "signal" || row.entry.role === "assistant";
  const silent = row.kind === "signal" && row.records[0].said === null;
  const text =
    row.kind === "chat" ? row.entry.text : (row.records[0].said ?? t("history.signal_silent"));
  return (
    <div
      className={`yui-hist__turn${isYui ? " is-yui" : ""}${row.kind === "signal" ? " is-signal" : ""}`}
    >
      {records.length > 0 && <SourceLines records={records} />}
      <span className="yui-hist__who">{isYui ? name : t("history.who_user")}</span>
      <span className={silent ? "yui-hist__say is-silent" : "yui-hist__say"}>{text}</span>
      <span className="yui-hist__ts">{formatTime(tsOf(row))}</span>
    </div>
  );
}
