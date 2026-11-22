/** The History page: the session list and its footnote, the start-fresh row, then the Session section. */

import { t } from "../../i18n";
import type { DelegationFeed } from "../delegations/delegation-feed";
import type { HistoryPorts } from "./history-ports";
import { SessionReadout } from "./session/session-readout";
import { SessionList } from "./session-list";
import { StartFresh } from "./start-fresh";

export interface HistoryPageViewProps {
  ports: HistoryPorts;
  delegations: DelegationFeed;
  characterName(): string;
  /** Absent where the reset stores are. */
  onReset?(): void;
  /** Moves on each open; the start-fresh confirm disarms with it. */
  revision: number;
}

export function HistoryPageView({
  ports,
  delegations,
  characterName,
  onReset,
  revision,
}: HistoryPageViewProps) {
  return (
    <>
      <div className="yui-sec">
        <SessionList ports={ports} characterName={characterName} />
        <p className="yui-hist__foot">{t("history.foot")}</p>
      </div>
      {onReset && <StartFresh key={revision} onReset={onReset} />}
      {ports.diagnostics && (
        <SessionReadout
          diagnostics={ports.diagnostics}
          lost={ports.lost}
          delegations={delegations}
        />
      )}
    </>
  );
}
