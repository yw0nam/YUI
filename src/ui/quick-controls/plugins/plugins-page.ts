/** The Plugins page: its view, and the entry that loads the catalog. */

import { createElement } from "react";
import type { McpHost, McpHostManage } from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { PluginsPageView } from "./plugins-page-view";
import { createPluginsState } from "./plugins-state";
import "./plugins-page.css";
import { type PageView, pageStack } from "../page-view";

export interface PluginsPage extends PageView {
  /** The page was entered: the catalog loads unless a load is in flight. */
  entered(): void;
}

export function createPluginsPage(deps: {
  host: McpHost;
  manage: McpHostManage;
  log: Logger;
}): PluginsPage {
  const state = createPluginsState(deps);
  return {
    view: () => pageStack(() => createElement(PluginsPageView, { state })),
    entered: () => state.load(),
  };
}
