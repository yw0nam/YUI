/** The Active hours editor: the span rows, the add action, and Reset to default; any edit writes the whole list. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import { MAX_SPANS, type Span, TIME_RE } from "../../../../settings/active-hours/spans";
import { t } from "../../../i18n";
import { PLUS_SVG } from "../../constants";
import { SpanRow } from "./span-row";

export interface ActiveHoursView {
  /** The user's edited spans; null while the card's apply. */
  edited: Span[] | null;
  /** The spans the rows show: the edited ones, else the card's. */
  spans: Span[];
}

export function ActiveHours({
  view,
  store,
  log,
}: {
  view: { get(): ActiveHoursView; subscribe(cb: () => void): () => void };
  store: Pick<ActiveHoursSettingsStore, "setSpans" | "reset">;
  log: Logger;
}) {
  const { edited, spans } = useSyncExternalStore(view.subscribe, view.get);
  const full = spans.length >= MAX_SPANS;

  // The whole row list is one edit: written only while every row holds a valid time.
  const commit = (next: Span[]) => {
    if (next.every((s) => TIME_RE.test(s.start) && TIME_RE.test(s.end))) store.setSpans(next);
  };

  return (
    <>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("active_hours.label")}</h2>
        <button
          className="yui-reset"
          type="button"
          hidden={edited === null}
          onClick={() => {
            store.reset();
            log.info("active_hours_reset");
          }}
        >
          {t("card.reset")}
        </button>
      </div>
      <p className="yui-sec__note">{t("active_hours.note")}</p>
      <div className="yui-group">
        <div className="yui-cue-list">
          {spans.map((span, i) => (
            <SpanRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position in the list
              key={i}
              span={span}
              onChange={(next) => commit(spans.map((s, j) => (j === i ? next : s)))}
              onRemove={() => commit(spans.filter((_, j) => j !== i))}
            />
          ))}
        </div>
        <div className="yui-row yui-row--action">
          <button
            className="yui-add-btn"
            type="button"
            disabled={full}
            onClick={() =>
              store.setSpans([...spans, { start: "09:00", end: "10:00", pace: "normal" }])
            }
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
            dangerouslySetInnerHTML={{ __html: `${PLUS_SVG}${t("active_hours.add")}` }}
          />
        </div>
      </div>
      <p className="yui-sec__note yui-hours__limit" hidden={!full}>
        {t("active_hours.add_limit")}
      </p>
      <p className="yui-sec__foot">{t("active_hours.foot")}</p>
    </>
  );
}
