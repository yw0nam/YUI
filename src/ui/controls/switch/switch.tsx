/** A boolean switch the caller labels and owns the state of. */

import "./switch.css";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  /** Accessible name; the caller passes the translated label. */
  label: string;
  /** Extra classes beside `yui-switch`. */
  className?: string;
  /** Blocks the click and renders the native disabled state. */
  disabled?: boolean;
  [data: `data-${string}`]: string | undefined;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
  ...data
}: SwitchProps) {
  return (
    <button
      {...data}
      disabled={disabled}
      className={className ? `yui-switch ${className}` : "yui-switch"}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
    />
  );
}
