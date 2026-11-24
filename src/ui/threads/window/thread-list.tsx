/** The Threads window's list pane: the Waiting / All segment, the kind select, and one row per Thread. */

import "./thread-list.css";
import { useRef } from "react";
import type { Thread } from "../../../contract";
import { Segment } from "../../controls/segment";
import { Select } from "../../controls/select";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";
import { relativeTime } from "./relative-time";
import { useKeepRowFocus } from "./row-focus";
import { kindItems, type ThreadFilter, type ThreadListView } from "./thread-list-view";
import { SourceLine, StateWord } from "./thread-meta";

/** The list pane's id, which the head's toggle controls. */
export const THREADS_LIST_ID = "yui-threads-list";

export interface ThreadNavProps {
  view: ThreadListView;
  filter: ThreadFilter;
  selected: string | null;
  onSelect(id: string): void;
  onFilter(filter: ThreadFilter): void;
}

function Row({
  thread,
  selected,
  now,
  onSelect,
}: {
  thread: Thread;
  selected: boolean;
  now: number;
  onSelect(id: string): void;
}) {
  return (
    <button
      type="button"
      className="yui-threads-row"
      data-id={thread.id}
      aria-current={String(selected) as "true" | "false"}
      onClick={() => onSelect(thread.id)}
    >
      <span className="yui-threads-row__meta">
        <SourceLine source={thread.source} />
        <StateWord thread={thread} />
        <time>{relativeTime(thread.updated_at, now)}</time>
      </span>
      <strong>{thread.title}</strong>
      {thread.label && (
        <span className="yui-threads-row__label" title={thread.label}>
          {thread.label}
        </span>
      )}
    </button>
  );
}

function emptyText(view: ThreadListView, filter: ThreadFilter): string {
  if (view.kind !== null) {
    const source = threadSource(view.kind).name;
    return t(filter.tab === "waiting" ? "threads.empty_kind_waiting" : "threads.empty_kind_all", {
      source,
    });
  }
  return t(filter.tab === "waiting" ? "threads.empty_waiting" : "threads.empty_all");
}

export function ThreadList({
  view,
  filter,
  selected,
  now,
  onSelect,
  onFilter,
}: ThreadNavProps & { now: number }) {
  const nav = useRef<HTMLElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const keepFocus = useKeepRowFocus(rows);
  const count = (n: number) => <span className="yui-threads-list__count">{n}</span>;
  return (
    <nav
      ref={nav}
      id={THREADS_LIST_ID}
      className="yui-threads-list"
      aria-label={t("threads.list_aria")}
    >
      <Segment
        className="yui-threads-list__tabs"
        label={t("threads.filter")}
        options={[
          {
            value: "waiting" as const,
            label: (
              <>
                {t("threads.tab_waiting")}
                {count(view.counts.waiting)}
              </>
            ),
          },
          {
            value: "all" as const,
            label: (
              <>
                {t("threads.tab_all")}
                {count(view.counts.all)}
              </>
            ),
          },
        ]}
        value={filter.tab}
        onValueChange={(tab) => onFilter({ ...filter, tab })}
      />
      {/* The popup renders inside the list, so a press on it keeps the medium overlay. */}
      <Select
        className="yui-threads-list__kind"
        aria-label={t("threads.kind")}
        value={view.kind ?? ""}
        items={kindItems(view)}
        onValueChange={(kind) => onFilter({ ...filter, kind: kind === "" ? null : kind })}
        container={nav}
      />
      <div ref={rows} className="yui-threads-list__rows" {...keepFocus}>
        {view.rows.length === 0 ? (
          <p className="yui-threads-list__empty">{emptyText(view, filter)}</p>
        ) : (
          view.rows.map((th) => (
            <Row
              key={th.id}
              thread={th}
              selected={th.id === selected}
              now={now}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </nav>
  );
}
