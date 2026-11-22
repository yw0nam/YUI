/** A controlled range slider the caller labels and owns the value of. */

import { Slider as BaseSlider, type SliderRoot } from "@base-ui/react/slider";
import "./slider.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Accessible name; the caller passes the translated label. */
  label: string;
  /** Spoken in place of the number. */
  valueText?: string;
  /** Each live change: a drag, a keyboard step, a track press. */
  onValueChange(value: number): void;
  /** The end of a change: a release, a keyboard step, a native change. */
  onValueCommitted(value: number, reason: SliderRoot.CommitEventReason): void;
  onBlur?(): void;
  /** Extra classes beside `yui-slider`. */
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

export function Slider({
  value,
  min,
  max,
  step,
  label,
  valueText,
  onValueChange,
  onValueCommitted,
  onBlur,
  className,
  ...data
}: SliderProps) {
  return (
    <BaseSlider.Root
      {...data}
      className={className ? `yui-slider ${className}` : "yui-slider"}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => onValueChange(next)}
      onValueCommitted={(next, details) => onValueCommitted(next, details.reason)}
    >
      <BaseSlider.Control className="yui-slider__control">
        <BaseSlider.Track className="yui-slider__track">
          <BaseSlider.Indicator className="yui-slider__fill" />
          <BaseSlider.Thumb
            className="yui-slider__thumb"
            aria-label={label}
            aria-valuetext={valueText}
            onBlur={onBlur}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
