/** Mouth-gain row — the lipsync gain slider, its live preview on the avatar, and its repaint. */

import type { Logger } from "../../../../logger";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../../../../settings/avatar/lipsync-settings";
import { bindSlider } from "../../slider-binding";

/** RMS a full-volume reply peaks at — gain times this is the mouth opening the preview shows. */
export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

export interface GainRow {
  /** Repaint slider, value and fill from the store. */
  refresh(): void;
  /** End a running preview — the tab's close hook. */
  endPreview(): void;
  dispose(): void;
}

export function createGainRow(deps: {
  root: HTMLElement;
  lipsync: ReturnType<typeof createLipsyncSettings>;
  /** Open the avatar's mouth to this amount while the slider is dragged. */
  onPreview: (mouthOpen: number) => void;
  onPreviewEnd: () => void;
  /** Skip repaints while the tab is closed. */
  isOpen: () => boolean;
  log: Logger;
}): GainRow {
  const { root, lipsync, onPreview, onPreviewEnd, isOpen, log } = deps;
  const slider = root.querySelector<HTMLInputElement>(".yui-lipsync-gain__slider")!;
  const value = root.querySelector<HTMLSpanElement>(".yui-lipsync-gain__value")!;
  slider.min = String(LIPSYNC_GAIN_MIN);
  slider.max = String(LIPSYNC_GAIN_MAX);
  slider.step = "0.1";

  let previewing = false;
  function endPreview(): void {
    if (!previewing) return;
    onPreviewEnd();
    previewing = false;
  }

  function refresh(): void {
    const gain = lipsync.get().gain;
    slider.value = String(gain);
    value.textContent = `${gain.toFixed(1)}×`;
    slider.style.setProperty(
      "--fill",
      String((gain - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)),
    );
  }

  const disposeSlider = bindSlider(
    {
      slider,
      parse: parseFloat,
      // The store subscription below repaints the row.
      setValue: (v: number) => lipsync.setGain(v),
      logKey: "mouth_gain_change",
      logField: "gain",
      onInputExtra: (v: number) => {
        previewing = true;
        onPreview(previewMouth(v));
      },
      onEndExtra: endPreview,
    },
    log,
  );
  const unsubscribe = lipsync.subscribe(() => {
    if (isOpen()) refresh();
  });

  return {
    refresh,
    endPreview,
    dispose(): void {
      unsubscribe();
      disposeSlider();
    },
  };
}
