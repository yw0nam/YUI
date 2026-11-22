/** The mouth-gain preview: the avatar's mouth opens to the gain while the slider moves, until it ends. */

/** RMS a full-volume reply peaks at — gain times this is the mouth opening the preview shows. */
export const PREVIEW_PEAK_RMS = 0.15;

export interface GainPreview {
  show(gain: number): void;
  /** Ends a running preview; without one it does nothing. */
  end(): void;
}

export function createGainPreview(deps: {
  onPreview: (mouthOpen: number) => void;
  onPreviewEnd: () => void;
}): GainPreview {
  let previewing = false;
  return {
    show(gain: number): void {
      previewing = true;
      deps.onPreview(Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS)));
    },
    end(): void {
      if (!previewing) return;
      previewing = false;
      deps.onPreviewEnd();
    },
  };
}
