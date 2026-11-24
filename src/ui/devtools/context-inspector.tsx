/** The context inspector: the sent turns newest first beside the selected turn's client context. */

import { useState } from "react";
import type { createContextHistory } from "../../io/chat/conversation/context-history";
import { t } from "../i18n";
import { useSnapshot } from "../use-snapshot/use-snapshot";

function timeOf(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ts);
}

export function ContextInspector({
  history,
}: {
  history: ReturnType<typeof createContextHistory>;
}) {
  const entries = useSnapshot(history.get, history.subscribe);
  const [selectedTs, setSelectedTs] = useState<number | null>(null);
  const newestFirst = [...entries].reverse();
  const selected = newestFirst.find((entry) => entry.ts === selectedTs) ?? newestFirst[0];
  // The selection stays on its turn while that turn exists, else moves to the newest.
  if (selected && selected.ts !== selectedTs) setSelectedTs(selected.ts);

  return (
    <>
      <div
        className="devtools-turns"
        role="listbox"
        aria-label={t("devtools.inspector.turns_aria")}
        hidden={newestFirst.length === 0}
      >
        {newestFirst.map((entry) => (
          <button
            key={entry.ts}
            type="button"
            className="devtools-turn"
            role="option"
            aria-selected={entry === selected}
            onClick={() => setSelectedTs(entry.ts)}
          >
            <span className="devtools-turn__top">
              <time>{timeOf(entry.ts)}</time>
              <span className="devtools-kind">{entry.trigger_kind}</span>
            </span>
            <span className="devtools-turn__summary">{entry.event_name}</span>
          </button>
        ))}
      </div>
      <div className="devtools-context-detail">
        {selected ? (
          <>
            <div className="devtools-detail-header">
              <time>{timeOf(selected.ts)}</time>
              <span className="devtools-kind">{selected.trigger_kind}</span>
              <span className="devtools-event">{selected.event_name}</span>
            </div>
            <pre className="devtools-json">{JSON.stringify(selected.client_context, null, 2)}</pre>
          </>
        ) : (
          <div className="devtools-empty">
            <strong>{t("devtools.inspector.empty_title")}</strong>
            <span>{t("devtools.inspector.empty_sub")}</span>
          </div>
        )}
      </div>
    </>
  );
}
