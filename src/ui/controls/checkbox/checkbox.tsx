/** A controlled tri-state checkbox the caller labels and owns the state of. */

export interface CheckboxProps {
  checked: boolean;
  /** Partly on; announced as mixed. */
  indeterminate?: boolean;
  onCheckedChange(checked: boolean): void;
  /** Accessible name; the caller passes the translated label. */
  label: string;
  /** Extra classes beside the checkbox's own. */
  className?: string;
}

export function Checkbox(_props: CheckboxProps) {
  return null;
}
