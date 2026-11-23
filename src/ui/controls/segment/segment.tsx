/** A radio segment the caller labels and owns the value of. */

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useState } from "react";
import "./segment.css";

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
  /** "focus" selects as arrows move; "activate" moves focus only, and Space or a click selects. */
  selectOn?: "focus" | "activate";
  /** Extra classes beside `yui-seg`. */
  className?: string;
  /** Disables every option. */
  disabled?: boolean;
}

export function Segment<T>({
  options,
  value,
  onValueChange,
  label,
  selectOn = "focus",
  className,
  disabled,
}: SegmentProps<T>) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [seenValue, setSeenValue] = useState(value);
  const checked = options.findIndex((option) => option.value === value);

  // A new value settles the tab stop on the checked radio.
  if (seenValue !== value) {
    setSeenValue(value);
    setFocusIndex(null);
  }

  const tabStop = focusIndex ?? (checked < 0 ? 0 : checked);

  return (
    <RadioGroup
      className={className ? `yui-seg ${className}` : "yui-seg"}
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      onKeyDownCapture={(event) => {
        // Arrows move focus only; Space or a click selects.
        if (selectOn === "activate" && event.key.startsWith("Arrow")) {
          event.preventBaseUIHandler();
        }
      }}
    >
      {options.map((option, index) => (
        <Radio.Root
          key={String(option.value)}
          value={option.value}
          nativeButton
          render={<button type="button" className="yui-seg__btn" />}
          tabIndex={index === tabStop ? 0 : -1}
          onFocus={() => setFocusIndex(index)}
          onClick={(event) => event.currentTarget.focus()}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
