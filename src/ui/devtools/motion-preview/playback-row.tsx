/** A rail row: its label beside its control, and the slider row built on it. */

import type { ReactNode } from "react";
import { Slider } from "../../controls/slider";

export function PlaybackRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="playback-row">
      <span className="playback-label">{label}</span>
      <div className="playback-control">{children}</div>
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value as the row shows it. */
  text: string;
  onChange(value: number): void;
}) {
  return (
    <PlaybackRow label={label}>
      <div className="slider-wrap">
        <Slider
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          valueText={text}
          onValueChange={onChange}
        />
        <span className="slider-value">{text}</span>
      </div>
    </PlaybackRow>
  );
}
