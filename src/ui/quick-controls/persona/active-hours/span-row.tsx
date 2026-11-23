/** One active-hours span row: start – end (next day) · pace · remove. */

import { useLayoutEffect, useRef } from "react";
import {
  PACES,
  type Pace,
  type Span,
  wrapsMidnight,
} from "../../../../settings/active-hours/spans";
import { Select } from "../../../controls/select";
import { t } from "../../../i18n";
import { CROSS_SVG } from "../../constants";
import { setValue } from "../set-value";

export function SpanRow({
  span,
  onPace,
  onRemove,
}: {
  span: Span;
  onPace(pace: Pace): void;
  onRemove(row: HTMLElement): void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    setValue(start.current, span.start);
    setValue(end.current, span.end);
  });

  return (
    <div className="yui-row yui-cue yui-hours__span" ref={row}>
      <div className="yui-hours__range">
        <input
          ref={start}
          type="time"
          className="yui-time-input"
          aria-label={t("active_hours.start_aria")}
        />
        <span className="yui-hours__dash" aria-hidden="true">
          –
        </span>
        <input
          ref={end}
          type="time"
          className="yui-time-input"
          aria-label={t("active_hours.end_aria")}
        />
        {wrapsMidnight(span) && (
          <span className="yui-cue__suffix">{t("active_hours.next_day")}</span>
        )}
      </div>
      <Select<Pace>
        className="yui-hours__pace"
        aria-label={t("active_hours.pace_aria")}
        value={span.pace}
        items={PACES.map((p) => ({ value: p, label: t(`active_hours.pace_${p}`) }))}
        onValueChange={onPace}
      />
      <button
        type="button"
        className="yui-cue__delete"
        aria-label={t("active_hours.remove_aria")}
        onClick={() => row.current && onRemove(row.current)}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
        dangerouslySetInnerHTML={{ __html: CROSS_SVG }}
      />
    </div>
  );
}
