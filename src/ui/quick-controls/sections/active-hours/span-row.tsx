/** One active-hours span row: start – end (next day) · pace · remove. */

import { useState } from "react";
import {
  PACES,
  type Pace,
  type Span,
  wrapsMidnight,
} from "../../../../settings/active-hours/spans";
import { t } from "../../../i18n";
import { CROSS_SVG } from "../../constants";

// A focused time input keeps what the user is typing; it catches up with the store on blur.
function TimeInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="time"
      className="yui-time-input"
      aria-label={label}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        if (draft !== null) setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export function SpanRow({
  span,
  onChange,
  onRemove,
}: {
  span: Span;
  onChange(next: Span): void;
  onRemove(): void;
}) {
  return (
    <div className="yui-row yui-cue yui-hours__span">
      <div className="yui-hours__range">
        <TimeInput
          value={span.start}
          label={t("active_hours.start_aria")}
          onChange={(start) => onChange({ ...span, start })}
        />
        <span className="yui-hours__dash" aria-hidden="true">
          –
        </span>
        <TimeInput
          value={span.end}
          label={t("active_hours.end_aria")}
          onChange={(end) => onChange({ ...span, end })}
        />
        {wrapsMidnight(span) && (
          <span className="yui-cue__suffix">{t("active_hours.next_day")}</span>
        )}
      </div>
      <select
        className="yui-select yui-hours__pace"
        aria-label={t("active_hours.pace_aria")}
        value={span.pace}
        onChange={(e) => onChange({ ...span, pace: e.target.value as Pace })}
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
        onClick={onRemove}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
        dangerouslySetInnerHTML={{ __html: CROSS_SVG }}
      />
    </div>
  );
}
