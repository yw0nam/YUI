/** The Developer Tools window: the header over the section tabs and their panels, redrawn in a new language. */

import { Tabs } from "@base-ui/react/tabs";
import { type Ref, useSyncExternalStore } from "react";
import type { createContextHistory } from "../../io/chat/conversation/context-history";
import type { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { Tab, TabPanel, type TabsHandle, TabsRoot, useTabs } from "../controls/tabs";
import { getLocale, subscribe as subscribeLocale, t } from "../i18n";
import { AdvancedSettings } from "./advanced-settings";
import { ContextInspector } from "./context-inspector";
import type { MotionLoad } from "./motion-preview/motion-load";
import { MotionPanel } from "./motion-preview/motion-panel";

const SECTIONS = ["context", "advanced", "motion"] as const;
export type DevtoolsSection = (typeof SECTIONS)[number];

export function DevtoolsWindow({
  tabs: handle,
  history,
  endpoints,
  defaultContextWindow,
  motion,
}: {
  tabs: Ref<TabsHandle>;
  history: ReturnType<typeof createContextHistory>;
  endpoints: ReturnType<typeof createEndpointsSettings>;
  defaultContextWindow?: number;
  motion: MotionLoad;
}) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const tabs = useTabs({
    ids: SECTIONS,
    initial: "context",
    onSelect: (id) => {
      if (id === "motion") void motion.begin();
    },
    handle,
  });

  return (
    <main className="devtools">
      <header className="devtools-header">{t("devtools.label")}</header>
      <TabsRoot tabs={tabs} orientation="vertical" className="devtools-body">
        <Tabs.List className="devtools-nav" aria-label={t("devtools.nav_aria")} activateOnFocus>
          {SECTIONS.map((id) => (
            <Tab
              key={id}
              value={id}
              className="yui-tab devtools-nav__item"
              // A click on the selected tab reports no selection, so a failed load retries from here.
              onClick={id === "motion" ? () => void motion.begin() : undefined}
            >
              {t(`devtools.nav.${id}`)}
            </Tab>
          ))}
        </Tabs.List>
        <div className="devtools-content">
          <TabPanel value="context" className="devtools-panel devtools-inspector">
            <ContextInspector history={history} />
          </TabPanel>
          <TabPanel value="advanced" className="devtools-panel devtools-advanced">
            <AdvancedSettings endpoints={endpoints} defaultContextWindow={defaultContextWindow} />
          </TabPanel>
          <TabPanel value="motion" className="devtools-panel">
            <MotionPanel motion={motion} />
          </TabPanel>
        </div>
      </TabsRoot>
    </main>
  );
}
