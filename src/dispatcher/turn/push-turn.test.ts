/**
 * push-turn.test.ts — which push turns the user stopped.
 *
 * The store is told when a turn goes out on the socket, when one of its renders is accepted, and
 * when the user cuts the reply. Everything outstanding at that moment is cut; a turn opened
 * afterwards starts clean.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { userEnv } from "../test-helpers";
import { createPushTurns } from "./push-turn";
import { createTurnLog } from "./turn";

describe("createPushTurns", () => {
  it("cut marks every turn outstanding at that moment", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    turns.rendered("A");
    turns.rendered("B");
    turns.cut();

    expect(turns.isCut("A")).toBe(true);
    expect(turns.isCut("B")).toBe(true);
  });

  it("a turn opened after the cut starts clean", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    turns.cut();
    turns.opened("C");

    expect(turns.isCut("A")).toBe(true);
    expect(turns.isCut("B")).toBe(true);
    expect(turns.isCut("C")).toBe(false);
  });

  it("a later opened never un-cuts an earlier turn", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.cut();
    turns.opened("C");
    turns.rendered("A");

    expect(turns.isCut("A")).toBe(true);
  });

  it("a cue-only frame keeps its turn live like any other accepted frame", () => {
    const turns = createPushTurns();

    turns.rendered("D");
    turns.cut();

    expect(turns.isCut("D")).toBe(true);
  });

  it("a turn nobody stopped is not cut", () => {
    const turns = createPushTurns();

    turns.opened("A");

    expect(turns.isCut("A")).toBe(false);
  });
});

describe("ended", () => {
  it("removes a cut turn's id from the stopped set", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.cut();
    expect(turns.isCut("A")).toBe(true);

    turns.ended("A");

    expect(turns.isCut("A")).toBe(false);
  });

  it("removes a live turn so the cut that follows sweeps nothing", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.rendered("A");
    turns.ended("A");
    turns.cut();

    expect(turns.isCut("A")).toBe(false);
    expect(turns.cutCount()).toBe(0);
  });

  it("changes nothing for an id nobody holds", () => {
    const turns = createPushTurns();

    turns.opened("A");

    expect(() => turns.ended("X")).not.toThrow();
    expect(turns.isCut("A")).toBe(false);
    expect(turns.cutCount()).toBe(0);
  });
});

describe("awaitTurnEnd", () => {
  /** Lets a pending promise settle without asserting on a value it may never have. */
  function watch(promise: Promise<"ended" | "cut">) {
    let settled: "ended" | "cut" | null = null;
    void promise.then((outcome) => {
      settled = outcome;
    });
    return {
      value: async (): Promise<"ended" | "cut" | null> => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return settled;
      },
    };
  }

  it("stays open across renders until the backend ends the turn", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const wait = watch(turns.awaitTurnEnd("A"));
    turns.rendered("A");
    turns.rendered("A");

    expect(await wait.value()).toBeNull();
  });

  it("another turn's frames leave it open", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    const wait = watch(turns.awaitTurnEnd("A"));
    turns.rendered("B");
    turns.ended("B");

    expect(await wait.value()).toBeNull();
  });

  it("resolves ended when the backend closes the turn", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const wait = turns.awaitTurnEnd("A");
    turns.ended("A");

    await expect(wait).resolves.toBe("ended");
  });

  it("resolves cut for every turn the cut sweeps", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    const a = turns.awaitTurnEnd("A");
    const b = turns.awaitTurnEnd("B");
    turns.cut();

    await expect(a).resolves.toBe("cut");
    await expect(b).resolves.toBe("cut");
  });

  it("fires onFirstRender once across two rendered calls", () => {
    const turns = createPushTurns();
    const firsts: string[] = [];

    turns.opened("A");
    void turns.awaitTurnEnd("A", { onFirstRender: () => firsts.push("first") });
    turns.rendered("A");
    turns.rendered("A");

    expect(firsts).toEqual(["first"]);
  });

  it("fires onFrame on every rendered and on ended", () => {
    const turns = createPushTurns();
    const frames: string[] = [];

    turns.opened("A");
    void turns.awaitTurnEnd("A", { onFrame: () => frames.push("frame") });
    turns.rendered("A");
    turns.rendered("A");
    turns.ended("A");

    expect(frames).toEqual(["frame", "frame", "frame"]);
  });

  it("runs onFirstRender before the render that carries it returns", () => {
    const turns = createPushTurns();
    const order: string[] = [];

    turns.opened("A");
    void turns.awaitTurnEnd("A", { onFirstRender: () => order.push("hook") });
    turns.rendered("A");
    order.push("returned");

    expect(order).toEqual(["hook", "returned"]);
  });

  it("a throwing hook leaves the render going and the wait open", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const wait = watch(
      turns.awaitTurnEnd("A", {
        onFirstRender: () => {
          throw new Error("the renderer is down");
        },
      }),
    );

    expect(() => turns.rendered("A")).not.toThrow();
    turns.ended("A");

    expect(await wait.value()).toBe("ended");
  });

  it("an abandoned wait settles nothing when its turn ends", async () => {
    const turns = createPushTurns();
    const settled: string[] = [];

    turns.opened("A");
    const wait = watch(turns.awaitTurnEnd("A", { onFirstRender: () => settled.push("A") }));
    turns.abandon("A");
    turns.rendered("A");
    turns.ended("A");

    expect(settled).toEqual([]);
    expect(await wait.value()).toBeNull();
  });
});

describe("a turn id the backend remembers across a restart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not cut this session's first turn with the last session's sweep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_717_000_000_000);
    const lastSession = String(createTurnLog().begin(userEnv()).id);

    const turns = createPushTurns();
    // The backend answers a turn this session never sent, and the user types over it.
    turns.rendered(lastSession);
    turns.cut();

    vi.setSystemTime(1_717_000_000_500);
    const thisSession = String(createTurnLog().begin(userEnv()).id);

    expect(turns.isCut(thisSession)).toBe(false);
  });
});
