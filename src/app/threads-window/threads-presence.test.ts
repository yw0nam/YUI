/** threads-presence.test.ts — an open while the Threads window shows brings it forward, keeping its frame, selection and filters. */

import { expect, it, vi } from "vitest";
import { createThreadsPresence } from "./threads-presence";

const CHIP = { x: 860, y: 700, width: 120, height: 32 };

it("brings a shown window forward on a second open, without placing or growing it again", async () => {
  const view = { open: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const show = vi.fn(async () => ({ x: 0, y: 600, width: 120, height: 32 }));
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    hide: async () => {},
    emitClosed: vi.fn(),
  });

  presence.open(CHIP);
  presence.open(CHIP);

  await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  expect(show).toHaveBeenCalledOnce();
  expect(view.open).toHaveBeenCalledOnce();
});
