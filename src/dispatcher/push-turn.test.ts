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
