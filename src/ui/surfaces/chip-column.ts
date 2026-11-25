/** Chip column — moves the column up for the bubble and the Ask card, folding what does not fit. */

export interface ColumnRow {
  top: number;
  bottom: number;
  urgent: boolean;
  count: number;
}

export interface ColumnPlan {
  shift: number;
  hide: number[];
  folded: number;
}

export function planColumn(_input: {
  rows: ColumnRow[];
  top: number;
  limit: number;
  edge: number;
  gap: number;
  foldRowHeight: number;
}): ColumnPlan {
  return undefined as never;
}

export function attachChipColumn(_deps: {
  root: HTMLElement;
  column: HTMLElement;
  bubble: HTMLElement;
  askSlot: HTMLElement;
}): () => void {
  return () => {};
}
