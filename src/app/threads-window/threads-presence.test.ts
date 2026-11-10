/** threads-presence.test.ts — an open while the Threads window shows brings it forward, keeping its frame, selection and filters. */

import { expect, it, vi } from "vitest";
import { createThreadsPresence } from "./threads-presence";

const CHIP = { x: 860, y: 700, width: 120, height: 32 };

it("brings a shown window forward on a second open, without placing or growing it again", async () => {
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    select: vi.fn(),
    hop: vi.fn(async () => {}),
  };
  const show = vi.fn(async () => ({ x: 0, y: 600, width: 120, height: 32 }));
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    raise: vi.fn(async () => {}),
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented: vi.fn(),
  });

  presence.open(CHIP);
  presence.open(CHIP);

  await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  expect(show).toHaveBeenCalledOnce();
  expect(view.open).toHaveBeenCalledOnce();
});

it("opens with no chip rect from no origin on the asked tab, and a later open's tab selects it", async () => {
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    select: vi.fn(),
    hop: vi.fn(async () => {}),
  };
  const show = vi.fn(async () => null);
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    raise: vi.fn(async () => {}),
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented: vi.fn(),
  });

  presence.open(undefined, "terminal");
  presence.open(CHIP);
  presence.open(CHIP, "threads");

  await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
  expect(show).toHaveBeenCalledWith(undefined, {});
  expect(view.open).toHaveBeenCalledWith(null, "terminal", {});
  expect(view.select.mock.calls).toEqual([["threads"]]);
});

it("runs the next open after a close whose view.close rejects", async () => {
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {
      throw new Error("close failed");
    }),
    select: vi.fn(),
    hop: vi.fn(async () => {}),
  };
  const show = vi.fn(async () => null);
  const focus = vi.fn(async () => {});
  const presence = createThreadsPresence({
    view,
    show,
    focus,
    raise: vi.fn(async () => {}),
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented: vi.fn(),
  });

  presence.open(CHIP);
  presence.close();
  presence.open(CHIP);

  await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  expect(show).toHaveBeenCalledOnce();
  expect(view.open).toHaveBeenCalledOnce();
});

it("an automatic open shows without focus, opens the view on the Thread, then reports presented", async () => {
  let grown!: () => void;
  const view = {
    open: vi.fn(() => new Promise<void>((resolve) => (grown = resolve))),
    close: vi.fn(async () => {}),
    select: vi.fn(),
    hop: vi.fn(async () => {}),
  };
  const show = vi.fn(async () => null);
  const emitPresented = vi.fn();
  const presence = createThreadsPresence({
    view,
    show,
    focus: vi.fn(async () => {}),
    raise: vi.fn(async () => {}),
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented,
  });

  presence.open(CHIP, "threads", { thread: "t2", focus: false, present: "p1" });

  await vi.waitFor(() => expect(view.open).toHaveBeenCalledOnce());
  expect(show).toHaveBeenCalledWith(CHIP, { thread: "t2", focus: false, present: "p1" });
  expect(view.open).toHaveBeenCalledWith(null, "threads", {
    thread: "t2",
    focus: false,
    present: "p1",
  });
  expect(emitPresented).not.toHaveBeenCalled();
  grown();
  await vi.waitFor(() => expect(emitPresented).toHaveBeenCalledExactlyOnceWith("p1"));
});

it("a raise brings the shown window forward keeping its tab and selection, and reports presented even when it fails", async () => {
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    select: vi.fn(),
    hop: vi.fn(async () => {}),
  };
  const focus = vi.fn(async () => {});
  const raise = vi.fn(async () => {
    throw new Error("no window");
  });
  const emitPresented = vi.fn();
  const presence = createThreadsPresence({
    view,
    show: vi.fn(async () => null),
    focus,
    raise,
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented,
  });

  presence.open(CHIP);
  presence.open(undefined, "terminal", { focus: false, present: "p2" });

  await vi.waitFor(() => expect(raise).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(emitPresented).toHaveBeenCalledExactlyOnceWith("p2"));
  expect(view.select).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
});

it.each([
  [
    "an automatic open of a shown window raises it, hops the panel, then reports presented",
    undefined,
    { focus: false, present: "p3" },
    ["raise", "hop", "presented:p3"],
  ],
  ["a user's open of a shown window brings it forward without a hop", CHIP, {}, ["focus"]],
] as const)("%s", async (_name, chip, opts, expected) => {
  const order: string[] = [];
  const view = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    select: vi.fn(),
    hop: vi.fn(async () => {
      order.push("hop");
    }),
  };
  const presence = createThreadsPresence({
    view,
    show: vi.fn(async () => null),
    focus: vi.fn(async () => {
      order.push("focus");
    }),
    raise: vi.fn(async () => {
      order.push("raise");
    }),
    hide: async () => {},
    emitClosed: vi.fn(),
    emitPresented: (present) => order.push(`presented:${present}`),
  });
  presence.open(CHIP);

  presence.open(chip, undefined, opts);

  await vi.waitFor(() => expect(order).toEqual(expected));
});
