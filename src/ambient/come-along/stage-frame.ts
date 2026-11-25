/** Her window's frame on and off the settings stage, in logical points. */

export type Size = { width: number; height: number };
export type Frame = { x: number; y: number } & Size;

/** Her window on `slot` at its whole-point size, her feet `feetShare` of her height down on its bottom edge. */
export function dockFrame(slot: Frame, feetShare: number): Frame {
  const height = Math.round(slot.height);
  return {
    x: Math.round(slot.x),
    y: Math.round(slot.y + slot.height - feetShare * height),
    width: Math.round(slot.width),
    height,
  };
}

/** `frame` resized to `size` about its bottom-centre, as a Ctrl+wheel resize keeps it. */
export function bottomCentred(frame: Frame, size: Size): Frame {
  return {
    x: Math.round(frame.x + (frame.width - size.width) / 2),
    y: Math.round(frame.y + frame.height - size.height),
    ...size,
  };
}

/** The frame `p` of the way from `from` to `to`, in whole points. */
export function easedFrame(from: Frame, to: Frame, p: number): Frame {
  const at = (a: number, b: number): number => Math.round(a + (b - a) * p);
  return {
    x: at(from.x, to.x),
    y: at(from.y, to.y),
    width: at(from.width, to.width),
    height: at(from.height, to.height),
  };
}

/** Whether `a` and `b` are a whole point or more apart on any side. */
export function differs(a: Frame, b: Frame): boolean {
  const off = [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height];
  return Math.max(...off.map(Math.abs)) >= 1;
}
