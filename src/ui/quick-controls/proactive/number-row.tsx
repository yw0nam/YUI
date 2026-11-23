/** A number row: label, sub and hint beside a NumberField and its unit slot. */

import { NumberField } from "../../controls/number-field";

export function NumberRow({
  id,
  label,
  sub,
  hint,
  min,
  max,
  unit,
  value,
  commit,
}: {
  id: string;
  label: string;
  sub?: string;
  hint?: string;
  min: number;
  max: number;
  unit?: string;
  /** The field's value; null shows it empty. */
  value: number | null;
  /** The committed value: a blur after typing, Enter, or a step. */
  commit(value: number | null): void;
}) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={id}>
          {label}
        </label>
        {sub ? <span className="yui-input-row__sub">{sub}</span> : null}
        {hint ? <span className="yui-row__sub">{hint}</span> : null}
      </div>
      <NumberField id={id} value={value} min={min} max={max} onCommit={commit}>
        <span className="yui-cue__suffix">{unit}</span>
      </NumberField>
    </div>
  );
}
