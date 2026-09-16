/**
 * push-turn.test.ts — which push turns the user stopped.
 *
 * The store is told when a turn goes out on the socket, when one of its renders is accepted, and
 * when the user cuts the reply. Everything outstanding at that moment is cut; a turn opened
 * afterwards starts clean.
 */

import { describe, expect, it } from "vitest";
import { createPushTurns } from "./push-turn";

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

  it("a render the backend started on its own adds nothing and removes nothing", () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.rendered(null);
    turns.cut();

    expect(turns.isCut("A")).toBe(true);
    expect(turns.isCut(null)).toBe(false);
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

describe("awaitFirstRender", () => {
  /** Lets a pending promise settle without asserting on a value it may never have. */
  function watch(promise: Promise<"rendered" | "cut">) {
    let settled: "rendered" | "cut" | null = null;
    void promise.then((outcome) => {
      settled = outcome;
    });
    return {
      value: async (): Promise<"rendered" | "cut" | null> => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return settled;
      },
    };
  }

  it("resolves rendered on the turn's first accepted frame", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const first = turns.awaitFirstRender("A");
    turns.rendered("A");

    await expect(first).resolves.toBe("rendered");
  });

  it("stays open while another turn renders", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    const first = watch(turns.awaitFirstRender("A"));
    turns.rendered("B");
    turns.rendered(null);

    expect(await first.value()).toBeNull();
  });

  it("resolves cut for every turn the cut sweeps", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    turns.opened("B");
    const a = turns.awaitFirstRender("A");
    const b = turns.awaitFirstRender("B");
    turns.cut();

    await expect(a).resolves.toBe("cut");
    await expect(b).resolves.toBe("cut");
  });

  it("runs the callback before the render that settled it returns", () => {
    const turns = createPushTurns();
    const order: string[] = [];

    turns.opened("A");
    void turns.awaitFirstRender("A", () => order.push("settle"));
    turns.rendered("A");
    order.push("returned");

    expect(order).toEqual(["settle", "returned"]);
  });

  it("settles the wait when its callback throws, and keeps the render going", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const first = turns.awaitFirstRender("A", () => {
      throw new Error("the renderer is down");
    });

    expect(() => turns.rendered("A")).not.toThrow();
    await expect(first).resolves.toBe("rendered");
  });

  it("a turn a settle callback opens is outside the cut that ran it", () => {
    const turns = createPushTurns();

    turns.opened("A");
    void turns.awaitFirstRender("A", () => turns.opened("B"));
    turns.cut();

    expect(turns.isCut("A")).toBe(true);
    expect(turns.isCut("B")).toBe(false);
  });

  it("an abandoned wait settles nothing when its render finally arrives", async () => {
    const turns = createPushTurns();
    const settled: string[] = [];

    turns.opened("A");
    const first = watch(turns.awaitFirstRender("A", () => settled.push("A")));
    turns.abandon("A");
    turns.rendered("A");

    expect(settled).toEqual([]);
    expect(await first.value()).toBeNull();
  });

  it("the render that resolves a wait takes the waiter with it", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const first = turns.awaitFirstRender("A");
    turns.rendered("A");

    await expect(first).resolves.toBe("rendered");

    const second = watch(turns.awaitFirstRender("A"));

    expect(await second.value()).toBeNull();
  });
});
