/** A number row: label, sub and hint beside the field and its unit slot; commits on change, then shows the value the store kept. */

import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { reflectUnlessEditing } from "../../surfaces/reflect-unless-editing";

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
  /** The text the field shows. */
  value: string;
  /** Gets the typed text on change (blur or Enter). */
  commit(raw: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, commit });

  useLayoutEffect(() => {
    latest.current = { value, commit };
  });

  useLayoutEffect(() => {
    if (input.current) reflectUnlessEditing(input.current, value);
  }, [value]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const reflect = () => reflectUnlessEditing(el, latest.current.value);
    // The store's answer renders first, then the field shows the value the store kept.
    const onChange = () => {
      flushSync(() => latest.current.commit(el.value));
      el.value = latest.current.value;
    };
    el.addEventListener("change", onChange);
    el.addEventListener("blur", reflect);
    return () => {
      el.removeEventListener("change", onChange);
      el.removeEventListener("blur", reflect);
    };
  }, []);

  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={id}>
          {label}
        </label>
        {sub ? <span className="yui-input-row__sub">{sub}</span> : null}
        {hint ? <span className="yui-row__sub">{hint}</span> : null}
      </div>
      <div className="yui-num">
        <input
          ref={input}
          className="yui-num-input"
          id={id}
          type="number"
          min={min}
          max={max}
          inputMode="numeric"
        />
        <span className="yui-cue__suffix">{unit}</span>
      </div>
    </div>
  );
}
