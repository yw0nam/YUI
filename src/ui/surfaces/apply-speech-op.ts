import {
  type MessageSurfaceOp,
  receiveSurfaceOp,
  type SurfacePort,
  type surfaceOps,
} from "../../io/bridge/message/surface-ops";

type Table = typeof surfaceOps;

/** The message ops that draw the bubble: the line and the quoted turn. */
export type SpeechOp = Extract<
  MessageSurfaceOp,
  { op: { [K in keyof Table]: Table[K] extends { bubble: true } ? K : never }[keyof Table] }
>;

/** Draws one bubble op on the surfaces, as the pet window's own bubble would have drawn it. */
export function applySpeechOp(op: SpeechOp, surfaces: SurfacePort<SpeechOp["op"]>): void {
  receiveSurfaceOp(op, surfaces, () => {});
}
