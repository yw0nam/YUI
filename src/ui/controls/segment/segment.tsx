/** A radio segment the caller labels and owns the value of. */

export interface SegmentOption<T> {
  value: T;
  label: string;
}

export interface SegmentProps<T> {
  options: readonly SegmentOption<T>[];
  /** The checked option; no option is checked when none equals it. */
  value: T;
  onValueChange(value: T): void;
  /** Accessible name of the radiogroup. */
  label: string;
  /** "focus" selects as arrows move; "activate" moves focus only, and Space, Enter or a click selects. */
  selectOn?: "focus" | "activate";
  /** Extra classes beside `yui-seg`. */
  className?: string;
}

export function Segment<T>({
  options,
  value,
  label,
  className,
}: SegmentProps<T>) {
  return (
    <div className={className ? `yui-seg ${className}` : "yui-seg"} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          className="yui-seg__btn"
          type="button"
          role="radio"
          aria-checked={Object.is(option.value, value)}
          tabIndex={Object.is(option.value, value) ? 0 : -1}
          data-value={String(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}