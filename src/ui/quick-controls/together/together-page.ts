/** The Together page: its view, and the open hook that re-reads the bundled defaults. */

import { createElement } from "react";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { createPageRevision, type PageView, pageStack } from "../page-view";
import type { SwitchRow } from "../switch-row";
import type { WindowsPort } from "./characters/characters-section";
import { TogetherPageView } from "./together-page-view";

export interface TogetherPage extends PageView {
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
      pageStack(
        () =>
          createElement(TogetherPageView, {
            ...deps,
            rateLimitDefaults: deps.getRateLimitDefaults?.(),
          }),
        { revision },
      ),
    reflect: revision.bump,
  };
}
