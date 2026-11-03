/** The Ask slot's place: it follows the input's anchor, and the bubble's lift line while the input is open. */

import type { SpeechBubble } from "../message/speech-bubble";

type BubbleLift = Pick<SpeechBubble, "liftAboveInput" | "resetPosition">;

const px = (value: number | null): string => (value === null ? "" : `${value}px`);

/** Lifts the bubble over the open input and puts the slot on the same line; resetting drops both. */
export function liftWithAskSlot(slot: HTMLElement, bubble: BubbleLift): BubbleLift {
  return {
    liftAboveInput(offsetPx) {
      bubble.liftAboveInput(offsetPx);
      slot.style.setProperty("--yui-ask-bottom", px(offsetPx));
    },
    resetPosition() {
      bubble.resetPosition();
      slot.style.setProperty("--yui-ask-bottom", px(null));
    },
  };
}

/** Anchors the input and the slot to the same bottom line; null returns both to the default. */
export function anchorWithAskSlot(
  slot: HTMLElement,
  setInputAnchor: (bottomPx: number | null) => void,
): (bottomPx: number | null) => void {
  return (bottomPx) => {
    setInputAnchor(bottomPx);
    slot.style.setProperty("--yui-input-bottom", px(bottomPx));
  };
}
