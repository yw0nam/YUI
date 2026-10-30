/** Where the Threads window opens, and the frame it remembers. */

import type { ScreenRect } from "../../contract";

export function createThreadsPlacement(_deps: {
  settings: {
    get(): { x?: number; y?: number; width: number; height: number };
    setFrame(frame: ScreenRect): void;
  };
}) {
  return {
    open: async (_chip: ScreenRect): Promise<ScreenRect> => ({ x: 0, y: 0, width: 0, height: 0 }),
    focus: async (): Promise<void> => {},
    hide: async (): Promise<void> => {},
    startDrag(): void {},
    current: async () => ({
      box: { x: 0, y: 0, width: 0, height: 0 },
      workArea: { x: 0, y: 0, width: 0, height: 0 },
    }),
    apply: async (_box: ScreenRect): Promise<void> => {},
    save(): void {},
  };
}
