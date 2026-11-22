/** A boolean switch the caller labels and owns the state of. */

export interface SwitchProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  /** Accessible name; the caller passes the translated label. */
  label: string;
  /** Extra classes beside `yui-switch`. */
  className?: string;
}

export function Switch({ checked, label, className }: SwitchProps) {
  return (
    <button
      className={className ? `yui-switch ${className}` : "yui-switch"}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
    />
  );
}
