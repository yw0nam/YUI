import type { Logger } from "../../logger";

// ── Shared slider input/end pattern ──
// input: parse the raw value, commit it to the store (a subscription redraws the row), optionally
// run an extra side effect (gain's lipsync preview). end (pointerup/blur): optionally end that side
// effect, then always log the committed value.
export interface SliderBinding<T> {
  slider: HTMLInputElement;
  parse: (raw: string) => T;
  setValue: (v: T) => void;
  logKey: string;
  logField: string;
  onInputExtra?: (v: T) => void;
  onEndExtra?: () => void;
}

export function bindSlider<T>(cfg: SliderBinding<T>, log: Logger): () => void {
  function handleInput(): void {
    const v = cfg.parse(cfg.slider.value);
    cfg.setValue(v);
    cfg.onInputExtra?.(v);
  }
  function handleEnd(): void {
    cfg.onEndExtra?.();
    log.info(cfg.logKey, { [cfg.logField]: cfg.parse(cfg.slider.value) });
  }
  cfg.slider.addEventListener("input", handleInput);
  cfg.slider.addEventListener("pointerup", handleEnd);
  cfg.slider.addEventListener("blur", handleEnd);
  return () => {
    cfg.slider.removeEventListener("input", handleInput);
    cfg.slider.removeEventListener("pointerup", handleEnd);
    cfg.slider.removeEventListener("blur", handleEnd);
  };
}
