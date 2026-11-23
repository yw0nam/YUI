/** The Proactive page: its view, and the open hook that re-reads what no store announces. */

import { createElement, type ReactNode } from "react";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { BasePaceSettingsStore } from "../../../settings/active-hours/base-pace-settings";
import type { createAgentNotifySettings } from "../../../settings/backend/agent-notify-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { createWorkflowSettings } from "../../../settings/backend/workflow-settings";
import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../../settings/capture/screen-settings";
import type { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import type { ClampedIntSettingsStore } from "../../../settings/persisted-store";
import type { ThreadReactionThresholdsSettingsStore } from "../../../settings/threads/thread-reaction-thresholds-settings";
import type { ThreadTurnsSettingsStore } from "../../../settings/threads/thread-turns-settings";
import { createPageRevision } from "../page-revision";
import type { SwitchRow } from "../switch-row";
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
  /** The page's switch-row descriptors, in row-table order. */
  rows: readonly SwitchRow[];
  /** Screen-watch threshold overrides. With its row, the Screen changes group renders. */
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Bundled config thresholds a knob falls back to when it carries no override (undefined if not loaded). */
  getScreenDefaults?: () => ScreenOverrides | undefined;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  threadTurnsSettings?: ThreadTurnsSettingsStore;
  threadReactionThresholdsSettings?: ThreadReactionThresholdsSettingsStore;
  boundId?: string | null;
  workflowSettings: ReturnType<typeof createWorkflowSettings>;
  log: Logger;
}

export interface ProactivePage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Re-reads the bundled defaults, the edited preset's face and name, and the clock: the open hook. */
  refresh(): void;
}

export function createProactivePage(deps: ProactivePageDeps): ProactivePage {
  const revision = createPageRevision();
  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack yui-proactive" },
        revision.view((n) =>
          createElement(ProactivePageView, {
            ...deps,
            rateLimitDefaults: deps.getRateLimitDefaults?.(),
            screenDefaults: deps.getScreenDefaults?.(),
            revision: n,
          }),
        ),
      ),
    refresh: revision.bump,
  };
}
