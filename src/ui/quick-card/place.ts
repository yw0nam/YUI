/** Where the quick card's top-left goes in the window. */

export const CARD_MARGIN = 12;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** At the click point, flipped left or above where it would cross the right edge or the visible bottom, kept 12px inside. */
export function placeCard(at: Point, card: Size, view: Size): Point {
  const x = at.x + card.width > view.width - CARD_MARGIN ? at.x - card.width : at.x;
  const y = at.y + card.height > view.height - CARD_MARGIN ? at.y - card.height : at.y;
  return {
    x: Math.max(CARD_MARGIN, Math.min(x, view.width - CARD_MARGIN - card.width)),
    y: Math.max(CARD_MARGIN, Math.min(y, view.height - CARD_MARGIN - card.height)),
  };
}
