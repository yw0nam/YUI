/** A controlled range slider the caller labels and owns the value of. */

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
  onValueCommitted?(value: number, reason: string): void;
}

export function Slider(_props: SliderProps) {
  return null;
}
