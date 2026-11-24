/**
 * The Threads window's rail, the list pane folded to 56px: the Waiting / All segment as a mark over
 * each count, the kind select behind a funnel mark, and one source mark per row of the same list
 * view, an Amber dot while it waits.
 */

import "./thread-rail.css";
import { useRef } from "react";
import type { Thread } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import { Segment } from "../../controls/segment";
import { Select } from "../../controls/select";
import { Tip } from "../../controls/tooltip";
import { t } from "../../i18n";
import { THREADS_PATHS } from "../glyphs";
import { threadSource } from "../thread-source";
import { Glyph } from "./glyph";
import { useKeepRowFocus } from "./row-focus";
import type { ThreadNavProps } from "./thread-list";
import { kindItems } from "./thread-list-view";
import { stateText } from "./thread-meta";

const WAITING_PATHS =
  '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>';
const FUNNEL_PATHS = '<path d="M4 5h16l-6 7.5V18l-4 2v-7.5z"/>';

function Item({
  thread,
  selected,
  onSelect,
}: {
  thread: Thread;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const name = `${thread.title} · ${stateText(thread)}`;
  return (
    <Tip text={name}>
      <button
        type="button"
        className="yui-threads-rail__item"
        data-id={thread.id}
        aria-current={String(selected) as "true" | "false"}
        aria-label={name}
        onClick={() => onSelect(thread.id)}
      >
        <span aria-hidden="true">{threadSource(thread.source).mark}</span>
        {isWaiting(thread) && <span className="yui-threads-rail__dot" aria-hidden="true" />}
      </button>
    </Tip>
  );
}

export function ThreadRail({ view, filter, selected, onSelect, onFilter }: ThreadNavProps) {
  const list = useRef<HTMLDivElement>(null);
  const keepFocus = useKeepRowFocus(list);
  const tab = (value: "waiting" | "all", paths: string, n: number) => {
    const name = t(value === "waiting" ? "threads.waiting_count" : "threads.all_count", { n });
    return {
      value,
      label: (
        <>
          <Glyph paths={paths} />
          <span className={`yui-threads-rail__count${value === "waiting" ? " is-waiting" : ""}`}>
            {n}
          </span>
        </>
      ),
      ariaLabel: name,
      tip: name,
    };
  };
  return (
    <nav className="yui-threads-rail" aria-label={t("threads.rail_aria")}>
      <div className="yui-threads-rail__top">
        <Segment
          className="yui-threads-rail__tabs"
          label={t("threads.filter")}
          options={[
            tab("waiting", WAITING_PATHS, view.counts.waiting),
            tab("all", THREADS_PATHS, view.counts.all),
          ]}
          value={filter.tab}
          onValueChange={(next) => onFilter({ ...filter, tab: next })}
        />
        <Select
          className={`yui-threads-rail__kind${view.kind === null ? "" : " is-active"}`}
          aria-label={t("threads.kind")}
          tip={t("threads.kind")}
          value={view.kind ?? ""}
          items={kindItems(view)}
          valueLabel={(kind) => (
            <span className="yui-threads-rail__kind-mark" aria-hidden="true">
              {kind === "" ? <Glyph paths={FUNNEL_PATHS} /> : threadSource(kind).mark}
            </span>
          )}
          onValueChange={(kind) => onFilter({ ...filter, kind: kind === "" ? null : kind })}
        />
      </div>
      <div ref={list} className="yui-threads-rail__list" {...keepFocus}>
        {view.rows.length === 0 ? (
          <p className="yui-threads-rail__empty">{t("threads.rail_empty")}</p>
        ) : (
          view.rows.map((th) => (
            <Item key={th.id} thread={th} selected={th.id === selected} onSelect={onSelect} />
          ))
        )}
      </div>
    </nav>
  );
}
