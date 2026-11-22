/** A radio segment the caller labels and owns the value of. */

import { type KeyboardEvent, useRef, useState } from "react";
import { handleSegmentKeydown } from "../../quick-controls/seg-keyboard";
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
  /** "focus" selects as arrows move; "activate" moves focus only, and Space, Enter or a click selects. */
  selectOn?: "focus" | "activate";
  /** Extra classes beside `yui-seg`. */
  className?: string;
}

export function Segment<T>({
  options,
  value,
  onValueChange,
  label,
  selectOn = "focus",
  className,
}: SegmentProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [seenValue, setSeenValue] = useState(value);
  const checked = options.findIndex((option) => Object.is(option.value, value));

  // A new value settles the tab stop on the checked button.
  if (!Object.is(seenValue, value)) {
    setSeenValue(value);
    setFocusIndex(null);
  }

  const clamp = (index: number): number => Math.min(options.length - 1, Math.max(0, index));

  const focusAt = (index: number): void => {
    setFocusIndex(index);
    buttons.current[index]?.focus();
  };

  const select = (index: number): void => {
    const option = options[index];
    if (option) onValueChange(option.value);
  };

  const tabStop = focusIndex ?? (checked < 0 ? 0 : checked);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    handleSegmentKeydown(
      event.nativeEvent,
      buttons.current.filter((button): button is HTMLButtonElement => !!button),
      {
        length: options.length,
        // Activation selects, so its arrows start from the checked radio; focus-only arrows start from the tab stop.
        getBaseIndex: () => (selectOn === "focus" ? (checked < 0 ? 0 : checked) : tabStop),
        onNavigate: (index, focus) => {
          const clamped = clamp(index);
          if (selectOn === "focus") select(clamped);
          if (focus) focusAt(clamped);
        },
        onCommit:
          selectOn === "activate"
            ? (index) => {
                select(index);
                focusAt(index);
              }
            : undefined,
      },
    );
  };

  return (
    <div
      className={className ? `yui-seg ${className}` : "yui-seg"}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useSemanticElements: a segment button styled and driven as a radio
        <button
          key={String(option.value)}
          ref={(button) => {
            buttons.current[index] = button;
          }}
          className="yui-seg__btn"
          type="button"
          role="radio"
          aria-checked={Object.is(option.value, value)}
          tabIndex={index === tabStop ? 0 : -1}
          data-value={String(option.value)}
          onClick={() => {
            select(index);
            focusAt(index);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
