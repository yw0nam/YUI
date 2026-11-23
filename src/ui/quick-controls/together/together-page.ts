/** The Together page: its React root, and the open hook that re-reads the bundled defaults. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { SwitchRow } from "../switch-row";
import type { WindowsPort } from "./characters/characters-section";
import { TogetherPageView } from "./together-page-view";

export interface TogetherPage {
  el: HTMLElement;
  /** Repaints the page, re-reading the bundled defaults. */
  reflect(): void;
  dispose(): void;
}

export function createTogetherPage(deps: {
  /** The page's switch-row descriptors, in row-table order. */
  rows: readonly SwitchRow[];
  rateLimitSettings?: GuardrailsSettingsStore;
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  registry?: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows?: WindowsPort;
  /** A bound window's own preset; turning it off would close the window showing this list. */
  boundId?: string | null;
  log: Logger;
}): TogetherPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(TogetherPageView, { ...deps, revision })));
  render();

  return {
    el,
    reflect(): void {
      revision++;
      render();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
