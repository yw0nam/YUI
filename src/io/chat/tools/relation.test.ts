import { describe, expect, it, vi } from "vitest";
import type { RateOutcome } from "../../../settings/relations/relations-store";
import { createRateRelationTool } from "./relation";

const NOW = 1_787_449_000_000;

function setup(
  targets = [{ id: "aaaa0001", name: "perlica" }],
  outcome: RateOutcome = { band: "neutral", applied: 2, clamped: false },
) {
  const store = { rate: vi.fn(() => outcome) };
  const list = { targets };
  const tool = createRateRelationTool({ store, targets: () => list.targets, now: () => NOW });
  return { tool, store, list };
}

describe("createRateRelationTool — definition", () => {
  it("declares user and the open presets as targets, read each time the schema is built", () => {
    const { tool, list } = setup();
    const toward = () =>
      (tool.definition.function.parameters.properties.toward as { enum: string[] }).enum;

    expect(toward()).toEqual(["user", "perlica"]);
    list.targets = [...list.targets, { id: "bbbb0002", name: "shino" }];
    expect(toward()).toEqual(["user", "perlica", "shino"]);
  });

  it("declares a preset named User as User (character) and rates its id", async () => {
    const { tool, store } = setup([{ id: "cccc0003", name: "User" }]);

    expect(
      (tool.definition.function.parameters.properties.toward as { enum: string[] }).enum,
    ).toEqual(["user", "User (character)"]);
    await tool.execute({ toward: "User (character)", delta: 1, why: "x" });
    expect(store.rate).toHaveBeenCalledWith("cccc0003", 1, "x", NOW);
  });
});

describe("createRateRelationTool — execute", () => {
  it.each([
    { args: { toward: "user", delta: 2, why: "x" }, id: "user" },
    { args: { toward: "perlica", delta: -1, why: "x" }, id: "aaaa0001" },
  ])("rates $args.toward under the id $id and answers the band", async ({ args, id }) => {
    const { tool, store } = setup();

    expect(await tool.execute(args)).toBe("neutral");
    expect(store.rate).toHaveBeenCalledWith(id, args.delta, "x", NOW);
  });

  it.each([
    { args: { toward: "nobody", delta: 1, why: "x" }, result: "error: unknown target" },
    { args: { toward: "user", delta: 3, why: "x" }, result: "error: invalid field delta" },
    { args: { toward: "user", delta: 1, why: 5 }, result: "error: invalid field why" },
  ])("answers $result and rates nothing", async ({ args, result }) => {
    const { tool, store } = setup();

    expect(await tool.execute(args)).toBe(result);
    expect(store.rate).not.toHaveBeenCalled();
  });

  it("accepts one call per target per turn", async () => {
    const { tool, store } = setup();
    const args = { toward: "user", delta: 1, why: "x" };

    await tool.execute(args, undefined, { turnId: "t1" });
    expect(await tool.execute(args, undefined, { turnId: "t1" })).toBe(
      "ignored: already rated user this turn",
    );
    expect(await tool.execute(args, undefined, { turnId: "t2" })).toBe("neutral");
    expect(store.rate).toHaveBeenCalledTimes(2);
  });

  it("answers clamped with the band when the store held the value", async () => {
    const { tool } = setup(undefined, { band: "warm", applied: 0, clamped: true });

    expect(await tool.execute({ toward: "user", delta: 2, why: "x" })).toBe("clamped: warm");
  });
});
