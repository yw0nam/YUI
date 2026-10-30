/** Turns the Threads window's handle moves into native bounds. */

import type { ScreenRect } from "../../contract";

export function createThreadsResize(_deps: {
  current(): Promise<{ box: ScreenRect; workArea: ScreenRect }>;
  apply(box: ScreenRect): Promise<void>;
  save(): void;
  nextFrame(cb: () => void): void;
}): {
  start(): void;
  move(edge: string, dx: number, dy: number): void;
  end(): Promise<void>;
} {
  return { start() {}, move() {}, end: async () => {} };
}
