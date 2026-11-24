/** The rail's pieces: a section header, a row with its label beside its control, and the slider row built on it. */

import type { ReactNode } from "react";
import { Slider } from "../../controls/slider";

export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="section-header">
      <span className="section-label">{label}</span>
      <div className="section-divider" />
    </div>
  );
}

export function RailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="playback-row">
      <span className="playback-label">{label}</span>
      <div className="playback-control">{children}</div>
    </div>
  );
}

export function RailSliderRow({
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
    <RailRow label={label}>
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
    </RailRow>
  );
}
