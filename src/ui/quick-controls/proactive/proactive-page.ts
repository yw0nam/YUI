/** The Proactive page: its React root, and the open hook that re-reads what no store announces. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { BasePaceSettingsStore } from "../../../settings/active-hours/base-pace-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import type { ClampedIntSettingsStore } from "../../../settings/persisted-store";
import { ProactivePageView } from "./proactive-page-view";
import "./proactive-page.css";

export interface ProactivePageDeps {
  basePaceSettings?: BasePaceSettingsStore;
  activeHoursSettings?: ActiveHoursSettingsStore;
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "current" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  scheduleSettings: ReturnType<typeof createScheduleSettings>;
  proactiveSettings: ReturnType<typeof createProactiveSettings>;
  openPersona(): void;
  pacerGapSettings?: ClampedIntSettingsStore;
  presenceSettings?: ClampedIntSettingsStore;
  rateLimitSettings?: GuardrailsSettingsStore;
  /** Bundled config caps a field falls back to when it carries no override (undefined if not loaded). */
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
}

export interface ProactivePage {
  el: HTMLElement;
  /** Re-reads the bundled defaults, the edited preset's face and name, and the clock: the open hook. */
  refresh(): void;
  dispose(): void;
}

export function createProactivePage(deps: ProactivePageDeps): ProactivePage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack yui-proactive";
  const root = createRoot(el);
  let revision = 0;
  const render = (): void =>
    flushSync(() =>
      root.render(
        createElement(ProactivePageView, {
          ...deps,
          rateLimitDefaults: deps.getRateLimitDefaults?.(),
          revision,
        }),
      ),
    );
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
