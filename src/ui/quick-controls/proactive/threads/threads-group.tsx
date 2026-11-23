/** Thread reactions: the waiting count and long wait segments, in a fold that dims while the source is off. */

import type { Logger } from "../../../../logger";
import {
  REACTION_COUNTS,
  REACTION_WAITS,
  type ReactionCount,
  type ReactionWait,
  type ThreadReactionThresholdsSettingsStore,
} from "../../../../settings/threads/thread-reaction-thresholds-settings";
import { Segment } from "../../../controls/segment/segment";
import { t } from "../../../i18n";
import { useSnapshot } from "../../../use-snapshot/use-snapshot";
import type { SwitchRow } from "../../switch-row";
import { SourceGroup } from "../source-group";

const countLabel = (n: ReactionCount): string =>
  n === 0 ? t("threadReactionThresholds.off") : t("threadReactionThresholds.count_value", { n });
const waitLabel = (n: ReactionWait): string =>
  n === 0 ? t("threadReactionThresholds.off") : t("threadReactionThresholds.wait_value", { n });

const emptyRead = () => undefined;
const subscribeNever = () => () => {};

export function ThreadsGroup({
  row,
  log,
  store,
}: {
  row: SwitchRow;
  log: Logger;
  store?: ThreadReactionThresholdsSettingsStore;
}) {
  const snapshot = useSnapshot(store?.get ?? emptyRead, store?.subscribe ?? subscribeNever);
  const aside = snapshot
    ? [
        snapshot.count > 0
          ? t("threadReactionThresholds.count_summary", { n: snapshot.count })
          : "",
        snapshot.wait_min > 0 ? waitLabel(snapshot.wait_min) : "",
      ]
        .filter(Boolean)
        .join(" · ") || t("threadReactionThresholds.off")
    : "";

  return (
    <SourceGroup row={row} log={log} title={t("threadReactions.fold")} aside={aside}>
      {store && snapshot ? (
        <>
          <div className="yui-row">
            <div className="yui-row__main">
              <span className="yui-row__label">{t("threadReactionThresholds.count_label")}</span>
              <span className="yui-row__sub">{t("threadReactionThresholds.count_sub")}</span>
            </div>
            <Segment
              className="yui-reaction-thresholds-count-seg"
              options={REACTION_COUNTS.map((n) => ({ value: n, label: countLabel(n) }))}
              value={snapshot.count}
              label={t("threadReactionThresholds.count_label")}
              onValueChange={store.setCount}
            />
          </div>
          <div className="yui-row">
            <div className="yui-row__main">
              <span className="yui-row__label">{t("threadReactionThresholds.wait_label")}</span>
              <span className="yui-row__sub">{t("threadReactionThresholds.wait_sub")}</span>
            </div>
            <Segment
              className="yui-reaction-thresholds-wait-seg"
              options={REACTION_WAITS.map((n) => ({ value: n, label: waitLabel(n) }))}
              value={snapshot.wait_min}
              label={t("threadReactionThresholds.wait_label")}
              onValueChange={store.setWait}
            />
          </div>
        </>
      ) : undefined}
    </SourceGroup>
  );
}
