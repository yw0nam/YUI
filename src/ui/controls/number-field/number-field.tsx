/** A controlled number field on Base UI's NumberField: the caller labels it and owns the value. */

import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import type { ReactNode } from "react";

const NO_GROUPING = { useGrouping: false } as const;

export interface NumberFieldProps {
  id: string;
  /** null shows an empty field. */
  value: number | null;
  min: number;
  max: number;
  /** The committed value: a blur after typing, Enter, or a step. */
  onCommit(value: number | null): void;
  /** What sits after the input in the field box, such as a unit. */
  children?: ReactNode;
}

export function NumberField({ id, value, min, max, onCommit, children }: NumberFieldProps) {
  return (
    <BaseNumberField.Root
      id={id}
      className="yui-num"
      value={value}
      min={min}
      max={max}
      allowOutOfRange
      format={NO_GROUPING}
      onValueCommitted={(next) => onCommit(next)}
    >
      <BaseNumberField.Input
        className="yui-num-input"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.defaultPrevented) return;
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          // Base UI commits on blur; keep the field focused after the commit.
          event.preventDefault();
          event.currentTarget.blur();
          event.currentTarget.focus({ preventScroll: true });
        }}
      />
      {children}
    </BaseNumberField.Root>
  );
}
