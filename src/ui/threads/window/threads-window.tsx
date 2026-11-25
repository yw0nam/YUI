/**
 * The Threads window's content: one head (the sidebar toggle, the Threads and Terminal tabs, the
 * count, Thread turns, ×) over both tabs' panels, and the tooltip every trigger in it shares.
 */

import "./threads-window.css";
import { Tabs } from "@base-ui/react/tabs";
import {
  type ComponentProps,
  type PointerEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { ThreadsTab as TabId } from "../../../io/bridge/settings-bridge";
import type { ThreadTurnsLevel } from "../../../settings/threads/thread-turns-settings";
import { Tab, TabPanel, type TabsHandle, TabsRoot, useTabs } from "../../controls/tabs";
import { TooltipHost } from "../../controls/tooltip";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { CROSS_SVG } from "../../quick-controls/constants";
import { RefMount } from "../../ref-mount";
import { Glyph } from "./glyph";
import type { TabView } from "./tab-body";
import { THREADS_LIST_ID } from "./thread-list";
import type { ThreadsTab } from "./threads-tab";
import { ThreadsTabView } from "./threads-tab-view";
import { type TurnsHandle, TurnsMenu } from "./turns-menu";

const TABS: readonly TabId[] = ["threads", "terminal"];
const SIDEBAR_PATHS = '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>';

type Heads = Record<TabId, ReturnType<TabView["head"]>>;

const headsOf = (bodies: Record<TabId, TabView>): Heads =>
  Object.fromEntries(TABS.map((id) => [id, bodies[id].head()])) as Heads;

export interface ThreadsWindowHandle {
  /** A tab's head count or waiting changed. */
  headChanged(): void;
}

export function ThreadsWindow({
  bodies,
  threads,
  threadsPanel,
  terminal,
  tabs: tabsHandle,
  turns,
  handle,
  onSelect,
  onRead,
  onBack,
  onClose,
  onHeadPointerDown,
  onTurnsLevel,
  attached,
  onAttach,
}: {
  /** Each tab's head, layout and keys. */
  bodies: Record<TabId, TabView>;
  threads: ThreadsTab;
  /** The Threads panel, where the Threads tab's focus moves look. */
  threadsPanel: Ref<HTMLDivElement>;
  /** The Terminal tab's vanilla body. */
  terminal: HTMLElement;
  tabs: Ref<TabsHandle>;
  turns: Ref<TurnsHandle>;
  handle: Ref<ThreadsWindowHandle>;
  onSelect(tab: TabId): void;
  onRead(id: string): void;
  onBack(): void;
  onClose(): void;
  /** A press on the head outside its buttons, the window's drag. */
  onHeadPointerDown(event: globalThis.PointerEvent): void;
  onTurnsLevel(level: ThreadTurnsLevel): void;
  attached: ComponentProps<typeof ThreadsTabView>["attached"];
  onAttach: ComponentProps<typeof ThreadsTabView>["onAttach"];
}) {
  const [heads, setHeads] = useState(() => headsOf(bodies));
  useImperativeHandle(handle, () => ({ headChanged: () => setHeads(headsOf(bodies)) }), [bodies]);
  // A new language redraws the heads and, with them, the whole window.
  useEffect(() => subscribeLocale(() => setHeads(headsOf(bodies))), [bodies]);
  const tabs = useTabs({
    ids: TABS,
    initial: "threads",
    onSelect: (id) => onSelect(id as TabId),
    handle: tabsHandle,
  });
  const sidebar = t("threads.sidebar");

  return (
    <TooltipHost>
      <TabsRoot tabs={tabs} className="yui-threads__tabs-root">
        <header
          className="yui-threads__head"
          onPointerDown={(e: PointerEvent) => {
            if (!(e.target as Element).closest("button")) onHeadPointerDown(e.nativeEvent);
          }}
        >
          <button
            type="button"
            className="yui-threads__toggle"
            aria-controls={THREADS_LIST_ID}
            aria-keyshortcuts="Control+Meta+S"
            aria-label={sidebar}
            title={`${sidebar} (⌃⌘S)`}
          >
            <Glyph paths={SIDEBAR_PATHS} />
          </button>
          <Tabs.List
            className="yui-threads__tabs"
            aria-label={t("threads.tabs_aria")}
            activateOnFocus
          >
            {TABS.map((id) => (
              <Tab key={id} value={id} className="yui-threads__tab">
                {t(id === "threads" ? "threads.title" : "terminal.title")}
                {id !== tabs.value && heads[id].waiting && (
                  <span className="yui-threads__tab-dot" aria-hidden="true" />
                )}
              </Tab>
            ))}
          </Tabs.List>
          <span className="yui-threads__count">{heads[tabs.value as TabId].count}</span>
          <TurnsMenu onPick={onTurnsLevel} handle={turns} />
          <button
            type="button"
            className="yui-threads__close"
            aria-label={t("threads.close")}
            onClick={onClose}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
            dangerouslySetInnerHTML={{ __html: CROSS_SVG }}
          />
        </header>
        <TabPanel value="threads" className="yui-threads__panes" ref={threadsPanel}>
          <ThreadsTabView
            tab={threads}
            shown={tabs.value === "threads"}
            onRead={onRead}
            onBack={onBack}
            attached={attached}
            onAttach={onAttach}
          />
        </TabPanel>
        <TabPanel value="terminal" className="yui-threads__terminal">
          <RefMount
            className="yui-threads__terminal-host"
            deps={[terminal]}
            mount={(host) => {
              host.append(terminal);
            }}
          />
        </TabPanel>
      </TabsRoot>
    </TooltipHost>
  );
}
