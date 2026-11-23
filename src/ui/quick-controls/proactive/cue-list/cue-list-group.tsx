/** A cue list's source group: its master switch row over a fold of the entries. */

import type { Cue, CueListSettings } from "../../../../settings/cues/cue-list-settings";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import { SourceFold } from "../source-group";
import { CueList } from "./cue-list";
import type { CueStore, CueTrigger } from "./cue-row";

export function CueListGroup<C extends Cue>({
  snapshot,
  store,
  title,
  sub,
  note,
  foldTitle,
  trigger,
  addLabel,
}: {
  /** The view's one read of the store. */
  snapshot: CueListSettings<C>;
  store: CueStore<C> & { setEnabled(enabled: boolean): void };
  title: string;
  sub: string;
  note?: string;
  foldTitle: string;
  trigger: CueTrigger;
  addLabel: string;
}) {
  const { enabled, entries } = snapshot;
  // Every entry's trigger in list order, e.g. "5 · 10 · 30 min" or "09:00 · 12:00".
  const list = entries
    .map((cue) => (cue as unknown as Record<string, unknown>)[trigger.field])
    .join(" · ");
  const aside = list && trigger.kind === "minutes" ? t("cue.minutes_summary", { list }) : list;
  return (
    <div className="yui-group">
      <div className="yui-row">
        <div className="yui-row__main">
          <span className="yui-row__label" data-testid="cue-list-title">
            {title}
          </span>
          <span className="yui-row__sub">{sub}</span>
          {note ? <span className="yui-row__sub">{note}</span> : null}
        </div>
        <Switch
          checked={enabled}
          label={title}
          onCheckedChange={(next) => store.setEnabled(next)}
        />
      </div>
      <SourceFold title={foldTitle} aside={aside} off={!enabled}>
        <CueList entries={entries} store={store} trigger={trigger} addLabel={addLabel} />
      </SourceFold>
    </div>
  );
}
