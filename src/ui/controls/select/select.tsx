/** A select on Base UI's Select: the caller labels it and owns the value; the popup lists the items. */

export interface SelectItem<V extends string> {
  value: V;
  label: string;
}

export interface SelectProps<V extends string> {
  id?: string;
  value: V;
  items: readonly SelectItem<V>[];
  onValueChange(value: V): void;
  disabled?: boolean;
  /** Extra classes beside `yui-select` on the trigger. */
  className?: string;
  "aria-label": string;
  /** The closed trigger's text, where it differs from the item's label in the popup. */
  valueLabel?: (value: V) => string;
}

export function Select<V extends string>(_props: SelectProps<V>) {
  return null;
}
