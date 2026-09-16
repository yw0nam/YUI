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

  it("a turn's second render finds no waiter left to resolve", async () => {
    const turns = createPushTurns();

    turns.opened("A");
    const first = turns.awaitFirstRender("A");
    turns.rendered("A");
    turns.rendered("A");
    turns.cut();

    await expect(first).resolves.toBe("rendered");
  });
});
