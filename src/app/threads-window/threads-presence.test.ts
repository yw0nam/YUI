/** threads-presence.test.ts — an open while the Threads window shows brings it forward, keeping its frame, selection and filters. */

import { expect, it, vi } from "vitest";
import { createThreadsPresence } from "./threads-presence";

const CHIP = { x: 860, y: 700, width: 120, height: 32 };

it("brings a shown window forward on a second open, without placing or growing it again", async () => {
  const view = { open: vi.fn(async () => {}), close: vi.fn(async () => {}), select: vi.fn() };
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

it("opens with no chip rect from no origin on the asked tab, and a later open's tab selects it", async () => {
  const view = { open: vi.fn(async () => {}), close: vi.fn(async () => {}), select: vi.fn() };
  const show = vi.fn(async () => null);
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    hide: async () => {},
    emitClosed: vi.fn(),
  });

  presence.open(undefined, "terminal");
  presence.open(CHIP);
  presence.open(CHIP, "threads");

  await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
  expect(show).toHaveBeenCalledWith(undefined);
  expect(view.open).toHaveBeenCalledWith(null, "terminal");
  expect(view.select.mock.calls).toEqual([["threads"]]);
});

it("runs the next open after a close whose view.close rejects", async () => {
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {
      throw new Error("close failed");
    }),
    select: vi.fn(),
  };
  const show = vi.fn(async () => null);
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    hide: async () => {},
    emitClosed: vi.fn(),
  });

  presence.open(CHIP);
  presence.close();
  presence.open(CHIP);

  await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  expect(show).toHaveBeenCalledOnce();
  expect(view.open).toHaveBeenCalledOnce();
});
