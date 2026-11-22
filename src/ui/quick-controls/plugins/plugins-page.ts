/** The Plugins page: its React root, and the open hook that loads the catalog. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { McpHost, McpHostManage } from "../../../io/mcp-host/mcp-host";
import type { Logger } from "../../../logger";
import { PluginsPageView } from "./plugins-page-view";
import { createPluginsState } from "./plugins-state";
import "./plugins-page.css";

export interface PluginsPage {
  el: HTMLElement;
  /** The page was entered: the catalog loads unless a load is in flight. */
  entered(): void;
  dispose(): void;
}

export function createPluginsPage(deps: {
  host: McpHost;
  manage: McpHostManage;
  log: Logger;
}): PluginsPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const state = createPluginsState(deps);
  const root = createRoot(el);
  flushSync(() => root.render(createElement(PluginsPageView, { state })));

  return {
    el,
    entered: () => state.load(),
    dispose(): void {
      state.dispose();
      root.unmount();
    },
  };
}
