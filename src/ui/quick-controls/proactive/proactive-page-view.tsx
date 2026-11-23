/** The Proactive page: how often she speaks up over her day, the sources, then Advanced. */

import type { RateLimitDefaults } from "../../../settings/backend/guardrails-settings";
import { useSnapshot } from "../../use-snapshot/use-snapshot";
import { AdvancedSection } from "./advanced/advanced-section";
import { PaceSection } from "./pace/pace-section";
import type { ProactivePageDeps } from "./proactive-page";

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
}: Omit<ProactivePageDeps, "getRateLimitDefaults" | "log"> & {
  rateLimitDefaults: RateLimitDefaults | undefined;
  /** Bumped by the open hook, so the page re-reads the defaults, her face and name, and the clock. */
  revision: number;
}) {
  // One read per cue store, shared by everything on the page that shows its entries.
  const proactive = useSnapshot(proactiveSettings.get, proactiveSettings.subscribe);
  const schedule = useSnapshot(scheduleSettings.get, scheduleSettings.subscribe);
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
        />
      ) : null}
      {/* The composer moves the source sections the template still renders in here. */}
      <div className="yui-tab-stack" data-slot="sources" />
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
