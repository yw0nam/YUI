/** The Plugins page: its view, and the entry that loads the catalog. */

import { createElement, type ReactNode, useEffect } from "react";
import type { McpHost, McpHostManage } from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { PluginsPageView } from "./plugins-page-view";
import { createPluginsState, type PluginsState } from "./plugins-state";
import "./plugins-page.css";

export interface PluginsPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** The page was entered: the catalog loads unless a load is in flight. */
  entered(): void;
}

/** The view; its unmount releases the page's state. */
function PluginsPage({ state }: { state: PluginsState }) {
  useEffect(() => () => state.dispose(), [state]);
  return createElement(PluginsPageView, { state });
}

export function createPluginsPage(deps: {
  host: McpHost;
  manage: McpHostManage;
  log: Logger;
}): PluginsPage {
  const state = createPluginsState(deps);
  return {
    view: () =>
      createElement("div", { className: "yui-tab-stack" }, createElement(PluginsPage, { state })),
    entered: () => state.load(),
  };
}
