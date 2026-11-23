/** The Together page: its view, and the open hook that re-reads the bundled defaults. */

import { createElement, type ReactNode } from "react";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { createPageRevision } from "../page-revision";
import type { SwitchRow } from "../switch-row";
import type { WindowsPort } from "./characters/characters-section";
import { TogetherPageView } from "./together-page-view";

export interface TogetherPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Repaints the page, re-reading the bundled defaults. */
  reflect(): void;
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
  const revision = createPageRevision();
  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        revision.view(() =>
          createElement(TogetherPageView, {
            ...deps,
            rateLimitDefaults: deps.getRateLimitDefaults?.(),
          }),
        ),
      ),
    reflect: revision.bump,
  };
}
