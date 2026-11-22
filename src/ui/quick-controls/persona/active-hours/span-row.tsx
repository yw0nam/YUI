/** One active-hours span row: start – end (next day) · pace · remove. */

import { useLayoutEffect, useRef } from "react";
import { PACES, type Span, wrapsMidnight } from "../../../../settings/active-hours/spans";
import { t } from "../../../i18n";
import { CROSS_SVG } from "../../constants";

// A focused control keeps what the user is typing; it catches up on blur.
function setValue(el: HTMLInputElement | HTMLSelectElement | null, value: string): void {
  if (!el) return;
  if (document.hasFocus() && document.activeElement === el) return;
  if (el.value !== value) el.value = value;
}

export function SpanRow({ span, onRemove }: { span: Span; onRemove(row: HTMLElement): void }) {
  const row = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLInputElement>(null);
  const pace = useRef<HTMLSelectElement>(null);

  useLayoutEffect(() => {
    setValue(start.current, span.start);
    setValue(end.current, span.end);
    setValue(pace.current, span.pace);
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
      <select
        ref={pace}
        className="yui-select yui-hours__pace"
        aria-label={t("active_hours.pace_aria")}
      >
        {PACES.map((p) => (
          <option key={p} value={p}>
            {t(`active_hours.pace_${p}`)}
          </option>
        ))}
      </select>
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
