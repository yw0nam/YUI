/** The reasoning-effort row in a section of its own. On push the segment is disabled with its reason. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import {
  type createAgentSettings,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../../../../settings/backend/agent-settings";
import { Segment } from "../../../controls/segment";
import { t } from "../../../i18n";
import { SEG_LABEL_KEYS } from "../../constants";
import { PushReason } from "../../sections/push-reason/push-reason";

export function EffortRow({
  agentSettings,
  push,
  log,
}: {
  agentSettings: Pick<
    ReturnType<typeof createAgentSettings>,
    "current" | "subscribe" | "setReasoningEffort"
  >;
  /** Push chat is the effective mode. */
  push: boolean;
  log: Logger;
}) {
  const effort = useSyncExternalStore(
    agentSettings.subscribe,
    () => agentSettings.current().reasoning_effort,
  );
  return (
    <div className="yui-sec">
      <div className="yui-group">
        <div className="yui-row">
          <div className="yui-row__main">
            <span className="yui-row__label">{t("reasoning.label")}</span>
            <span className="yui-row__sub">{t("reasoning.sub")}</span>
            <PushReason reasonKey="push.reason_effort" hidden={!push} />
          </div>
          <Segment<ReasoningEffort>
            className="yui-effort-seg"
            label={t("reasoning.label")}
            options={REASONING_EFFORTS.map((e) => ({ value: e, label: t(SEG_LABEL_KEYS[e]) }))}
            value={effort}
            disabled={push}
            onValueChange={(next) => {
              agentSettings.setReasoningEffort(next);
              log.info("reasoning_effort_change", { effort: next });
            }}
          />
        </div>
      </div>
    </div>
  );
}
