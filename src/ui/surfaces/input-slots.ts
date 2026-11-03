/** The Ask and Command reply slots follow the input's anchor and the bubble's lift line. */

import type { SpeechBubble } from "../message/speech-bubble";

type BubbleLift = Pick<SpeechBubble, "liftAboveInput" | "resetPosition">;

const px = (value: number | null): string => (value === null ? "" : `${value}px`);

/** Lifts the bubble over the open input and puts both slots on the same line; resetting drops them. */
export function liftWithInputSlots(slots: readonly HTMLElement[], bubble: BubbleLift): BubbleLift {
  return {
    liftAboveInput(offsetPx) {
      bubble.liftAboveInput(offsetPx);
      for (const slot of slots) slot.style.setProperty("--yui-slot-bottom", px(offsetPx));
    },
    resetPosition() {
      bubble.resetPosition();
      for (const slot of slots) slot.style.setProperty("--yui-slot-bottom", px(null));
    },
  };
}

/** Anchors the input and both slots to the same bottom line; null returns both to the default. */
export function anchorWithInputSlots(
  slots: readonly HTMLElement[],
  setInputAnchor: (bottomPx: number | null) => void,
): (bottomPx: number | null) => void {
  return (bottomPx) => {
    setInputAnchor(bottomPx);
    for (const slot of slots) slot.style.setProperty("--yui-input-bottom", px(bottomPx));
  };
}
