/** External signals: Thread turns, the listener port and address, then the workflows, in one fold. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import {
  type AgentNotifySettingsStore,
  ingressUrl,
} from "../../../../settings/backend/agent-notify-settings";
import type { createWorkflowSettings } from "../../../../settings/backend/workflow-settings";
import {
  THREAD_TURNS,
  type ThreadTurnsSettingsStore,
} from "../../../../settings/threads/thread-turns-settings";
import { Segment } from "../../../controls/segment/segment";
import { t } from "../../../i18n";
import type { SwitchRow } from "../../switch-row";
import { NumberRow } from "../number-row";
import { SourceGroup } from "../source-group";
import { WorkflowList } from "../workflows/workflow-list";

const subscribeNever = () => () => {};

export function SignalsGroup({
  row,
  log,
  store,
  threadTurns,
  boundId,
  workflowStore,
}: {
  row: SwitchRow;
  log: Logger;
  store: AgentNotifySettingsStore;
  threadTurns?: ThreadTurnsSettingsStore;
  boundId: string | null;
  workflowStore: ReturnType<typeof createWorkflowSettings>;
}) {
  const port = useSyncExternalStore(store.subscribe, () => store.get().port);
  const level = useSyncExternalStore(threadTurns?.subscribe ?? subscribeNever, () =>
    threadTurns ? threadTurns.get().level : "off",
  );

  return (
    <SourceGroup row={row} log={log} title={t("agentNotify.fold")} aside={String(port)}>
      {threadTurns ? (
        <div className="yui-row">
          <div className="yui-row__main">
            <span className="yui-row__label">{t("threadTurns.label")}</span>
            <span className="yui-row__sub">{t("threadTurns.sub")}</span>
          </div>
          <Segment
            className="yui-threadturns-seg"
            options={THREAD_TURNS.map((turn) => ({ value: turn, label: t(`threadTurns.${turn}`) }))}
            value={level}
            label={t("threadTurns.aria")}
            onValueChange={threadTurns.setLevel}
          />
        </div>
      ) : null}
      <NumberRow
        id="yui-agent-port"
        label={t("reactions.port_label")}
        sub={t("reactions.port_sub")}
        hint={t("reactions.restart_hint")}
        min={1024}
        max={65535}
        value={String(port)}
        commit={(raw) => store.setPort(Math.round(Number(raw)))}
      />
      <div className="yui-stack yui-input-row">
        <span className="yui-input-row__label">{t("reactions.url_label")}</span>
        <span className="yui-row__sub">{t("reactions.url_sub")}</span>
        <code id="yui-ingress-url" className="yui-quick__ingress-url">
          {ingressUrl(port, boundId)}
        </code>
        <span className="yui-row__sub">{t("reactions.restart_hint")}</span>
      </div>
      <WorkflowList store={workflowStore} log={log} />
    </SourceGroup>
  );
}
