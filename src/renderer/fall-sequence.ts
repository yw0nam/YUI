/**
 * fall-sequence — stub (red phase).
 */

export enum FallState {
  Idle = "idle",
}

export interface FallSequenceDeps {
  playMotion(id: string | null): void;
}

export interface FallSequence {
  start(): void;
  cancel(): void;
  state(): FallState;
}

export function createFallSequence(_deps: FallSequenceDeps): FallSequence {
  throw new Error("not implemented");
}
