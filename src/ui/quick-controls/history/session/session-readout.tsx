/** The History page's Session section: the context-occupancy readout, and the delegated work under it. */

import { type ReactNode, useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import type { DelegationFeed } from "../delegations/delegation-feed";
import type { HistoryPorts } from "../history-ports";
import { DelegatedRows } from "./delegated-rows";
import "./session-section.css";

// Format token count as "18.2K" / "18K" / "200K". Below 1000 stays as-is,
// below 100K shows one decimal (dropping .0), 100K+ shows integer.
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

function Occupancy({
  diagnostics,
}: {
  diagnostics: NonNullable<HistoryPorts["diagnostics"]>;
}): ReactNode {
  const { usedTokens: used, contextWindow: max } = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.read,
  );
  // With no contextWindow the readout shows the usage alone, with no bar or percent.
  const pct =
    used !== null && max !== null && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null;
  return (
    <div className="yui-stack yui-session__stat">
      <div className="yui-session__statline">
        <span className="yui-session__label">{t("session.context")}</span>
        <span className="yui-session__value">
          {used === null ? (
            "—"
          ) : pct === null ? (
            formatTokenCount(used)
          ) : (
            <>
              {`${formatTokenCount(used)} / ${formatTokenCount(max!)}`}
              <span className="pct">{`${pct}%`}</span>
            </>
          )}
        </span>
      </div>
      {pct !== null && (
        <div className="yui-meter">
          <div
            className={pct >= 85 ? "yui-meter__fill is-high" : "yui-meter__fill"}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function SessionReadout({
  diagnostics,
  lost,
  delegations,
}: {
  diagnostics: NonNullable<HistoryPorts["diagnostics"]>;
  lost: HistoryPorts["lost"];
  delegations: DelegationFeed;
}) {
  const isLost = useSyncExternalStore(lost.subscribe, lost.read);
  useSyncExternalStore(delegations.subscribe, delegations.version);
  const items = delegations.get();
  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("session.section")}</h2>
      </div>
      <div className="yui-group yui-session">
        <Occupancy diagnostics={diagnostics} />
        <div className="yui-stack yui-session__deleg" hidden={!isLost && items.length === 0}>
          <h3 className="yui-session__deleg-title">{t("deleg.list_title")}</h3>
          <p className="yui-session__deleg-lost" hidden={!isLost}>
            <span className="yui-session__deleg-lost-dot" aria-hidden="true" />
            <span>{t("deleg.chip_lost")}</span>
          </p>
          <DelegatedRows items={items} />
        </div>
      </div>
    </div>
  );
}
