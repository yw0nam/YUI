/** What the list and the rail show of a snapshot: the rows, the counts, the kinds, and the Thread an open shows. */

import type { Thread } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";

export interface ThreadFilter {
  tab: "waiting" | "all";
  /** A source, or null for all kinds. */
  kind: string | null;
}

export interface ThreadListView {
  rows: Thread[];
  counts: { waiting: number; all: number };
  /** Every source in the snapshot, counted within the tab; a zero count is disabled unless selected. */
  kinds: { source: string; count: number; disabled: boolean }[];
  /** The kind in effect: the filter's, or null once that source left the snapshot. */
  kind: string | null;
}

const waitingFirstThenNewest = (a: Thread, b: Thread): number =>
  Number(isWaiting(b)) - Number(isWaiting(a)) || b.updated_at - a.updated_at;

export function threadListView(threads: Thread[], filter: ThreadFilter): ThreadListView {
  const sources = [...new Set(threads.map((th) => th.source))].sort();
  const kind = filter.kind !== null && sources.includes(filter.kind) ? filter.kind : null;
  const inTab = threads.filter((th) => filter.tab === "all" || isWaiting(th));
  return {
    rows: inTab.filter((th) => kind === null || th.source === kind).sort(waitingFirstThenNewest),
    counts: { waiting: threads.filter(isWaiting).length, all: threads.length },
    kinds: sources.map((source) => {
      const count = inTab.filter((th) => th.source === source).length;
      return { source, count, disabled: count === 0 && source !== kind };
    }),
    kind,
  };
}

/** What the list and the rail draw from and report to. */
export interface ThreadNavProps {
  view: ThreadListView;
  filter: ThreadFilter;
  selected: string | null;
  onSelect(id: string): void;
  onFilter(filter: ThreadFilter): void;
}

/** The kind select of the list or the rail: all kinds as "", then each source with its count in the tab. */
export function kindSelect({
  view,
  filter,
  onFilter,
}: Pick<ThreadNavProps, "view" | "filter" | "onFilter">) {
  const inTab = view.kinds.reduce((n, k) => n + k.count, 0);
  return {
    "aria-label": t("threads.kind"),
    value: view.kind ?? "",
    items: [
      { value: "", label: t("threads.kind_all", { n: inTab }) },
      ...view.kinds.map((k) => ({
        value: k.source,
        label: `${threadSource(k.source).name} (${k.count})`,
        disabled: k.disabled,
      })),
    ],
    onValueChange: (kind: string) => onFilter({ ...filter, kind: kind === "" ? null : kind }),
  };
}

/** The waiting Thread after `id` in `rows`, else the nearest one before it, else `id`. */
export function nextWaiting(rows: Thread[], threads: Thread[], id: string): string {
  const at = rows.findIndex((th) => th.id === id);
  const waiting = new Set(threads.filter(isWaiting).map((th) => th.id));
  const around = [...rows.slice(at + 1), ...rows.slice(0, at).reverse()];
  return around.find((th) => waiting.has(th.id))?.id ?? id;
}

/** The Thread a fresh open shows: the newest waiting one, else the newest. */
export function openSelection(threads: Thread[]): string | null {
  return [...threads].sort(waitingFirstThenNewest)[0]?.id ?? null;
}
