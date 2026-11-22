/** A controlled tri-state checkbox, drawn as a switch, the caller labels and owns the state of. */

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import "../switch/switch.css";
import "./checkbox.css";

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

export function Checkbox({
  checked,
  indeterminate,
  onCheckedChange,
  label,
  className,
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={className ? `yui-switch yui-checkbox ${className}` : "yui-switch yui-checkbox"}
      checked={checked}
      indeterminate={indeterminate}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
    />
  );
}
