/** The Proactive page: how often she speaks up over her day, the sources, then Advanced. */

import type { RateLimitDefaults } from "../../../settings/backend/guardrails-settings";
import type { ScreenOverrides } from "../../../settings/capture/screen-settings";
import { t } from "../../i18n";
import { useSnapshot } from "../../use-snapshot/use-snapshot";
import type { SwitchRow } from "../switch-row";
import { AdvancedSection } from "./advanced/advanced-section";
import { CueListGroup } from "./cue-list/cue-list-group";
import { PaceSection } from "./pace/pace-section";
import type { ProactivePageDeps } from "./proactive-page";
import { ScreenGroup } from "./screen/screen-group";
import { SignalsGroup } from "./signals/signals-group";
import { ThreadsGroup } from "./threads/threads-group";

const MINUTES = { kind: "minutes", field: "idle_min" } as const;
const TIME = { kind: "time", field: "time" } as const;

const rowAt = (
  rows: readonly SwitchRow[],
  position: SwitchRow["position"],
): SwitchRow | undefined => rows.find((row) => row.position === position && row.isVisible);

export function ProactivePageView({
  basePaceSettings,
  activeHoursSettings,
  agentSettings,
  getPersona,
  scheduleSettings,
  proactiveSettings,
  openPersona,
  pacerGapSettings,
  presenceSettings,
  rateLimitSettings,
  rateLimitDefaults,
  rows,
  screenKnobSettings,
  screenDefaults,
  agentNotifySettings,
  threadTurnsSettings,
  threadReactionThresholdsSettings,
  boundId,
  workflowSettings,
  log,
  revision,
}: Omit<ProactivePageDeps, "getRateLimitDefaults" | "getScreenDefaults"> & {
  rateLimitDefaults: RateLimitDefaults | undefined;
  screenDefaults: ScreenOverrides | undefined;
  /** Bumped by the open hook, so the page re-reads the defaults, her face and name, and the clock. */
  revision: number;
}) {
  // One read per cue store, shared by everything on the page that shows its entries.
  const proactive = useSnapshot(proactiveSettings.get, proactiveSettings.subscribe);
  const schedule = useSnapshot(scheduleSettings.get, scheduleSettings.subscribe);
  const screenRow = rowAt(rows, "screen");
  const threadsRow = rowAt(rows, "threads");
  const signalsRow = rowAt(rows, "signals");

  return (
    <>
      {basePaceSettings ? (
        <PaceSection
          basePaceSettings={basePaceSettings}
          openPersona={openPersona}
          activeHoursSettings={activeHoursSettings}
          agentSettings={agentSettings}
          getPersona={getPersona}
          proactive={proactive}
          schedule={schedule}
          revision={revision}
        />
      ) : null}
      <div className="yui-sec">
        <div className="yui-sec__head">
          <h2 className="yui-sec__title">{t("reactions.reacts_title")}</h2>
        </div>
        <CueListGroup
          snapshot={proactive}
          store={proactiveSettings}
          title={t("cue.proactive_title")}
          sub={t("cue.proactive_sub")}
          foldTitle={t("cue.proactive_fold")}
          trigger={MINUTES}
          addLabel={t("cue.proactive_add")}
        />
        <CueListGroup
          snapshot={schedule}
          store={scheduleSettings}
          title={t("cue.schedule_title")}
          sub={t("cue.schedule_sub")}
          note={t("cue.schedule_note")}
          foldTitle={t("cue.schedule_fold")}
          trigger={TIME}
          addLabel={t("cue.schedule_add")}
        />
        {screenRow && screenKnobSettings ? (
          <ScreenGroup
            row={screenRow}
            log={log}
            store={screenKnobSettings}
            defaults={screenDefaults}
          />
        ) : null}
        {threadsRow ? (
          <ThreadsGroup row={threadsRow} log={log} store={threadReactionThresholdsSettings} />
        ) : null}
        {signalsRow && agentNotifySettings ? (
          <SignalsGroup
            row={signalsRow}
            log={log}
            store={agentNotifySettings}
            threadTurns={threadTurnsSettings}
            boundId={boundId ?? null}
            workflowStore={workflowSettings}
          />
        ) : null}
      </div>
      {pacerGapSettings || presenceSettings || rateLimitSettings ? (
        <AdvancedSection
          pacerGapSettings={pacerGapSettings}
          presenceSettings={presenceSettings}
          rateLimitSettings={rateLimitSettings}
          rateLimitDefaults={rateLimitDefaults}
        />
      ) : null}
    </>
  );
}
