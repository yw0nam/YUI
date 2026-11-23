/** A controlled number field on Base UI's NumberField: the caller labels it and owns the value. */

import type { ReactNode } from "react";

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

export function NumberField(_props: NumberFieldProps): ReactNode {
  return null;
}