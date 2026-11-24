/** The Threads tab's view: the list pane, its rail and the thread pane, drawn from the tab's state. */

import { type RefObject, useRef, useSyncExternalStore } from "react";
import { focusCurrentRow } from "./row-focus";
import { ThreadList } from "./thread-list";
import { ThreadPane } from "./thread-pane";
import { ThreadRail } from "./thread-rail";
import type { ThreadsTab, ThreadsTabFocus } from "./threads-tab";

/** The focus moves of the tab drawn in `panel`. */
export function threadsTabFocus(panel: RefObject<Element | null>): ThreadsTabFocus {
  const find = (selector: string) => panel.current?.querySelector<HTMLElement>(selector) ?? null;
  return {
    heading: () => find(".yui-threads-pane h2")?.focus(),
    inPane: () => find(".yui-threads-pane")?.contains(document.activeElement) ?? false,
    list: () => focusCurrentRow(find(".yui-threads-list__rows")),
    rail: () => focusCurrentRow(find(".yui-threads-rail__list")),
  };
}

export function ThreadsTabView({
  tab,
  shown,
  onRead,
  onBack,
}: {
  tab: ThreadsTab;
  /** Whether the tab shows. */
  shown: boolean;
  onRead(id: string): void;
  onBack(): void;
}) {
  const state = useSyncExternalStore(tab.subscribe, tab.current);
  const thread = state.threads.find((th) => th.id === state.selected);
  // A hidden transcript reads no scroll position, so the pane holds its Thread until its tab shows.
  const drawn = useRef(thread);
  if (shown) drawn.current = thread;
  return (
    <>
      <ThreadList
        view={state.view}
        filter={state.filter}
        selected={state.selected}
        now={state.now}
        onSelect={tab.select}
        onFilter={tab.setFilter}
      />
      <ThreadRail
        view={state.view}
        filter={state.filter}
        selected={state.selected}
        onSelect={tab.select}
        onFilter={tab.setFilter}
      />
      <ThreadPane
        thread={drawn.current}
        opened={state.opened}
        now={state.now}
        answers={tab.answers}
        onRead={onRead}
        onBack={onBack}
      />
    </>
  );
}
