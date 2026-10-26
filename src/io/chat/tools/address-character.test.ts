import { describe, expect, it, vi } from "vitest";
import { createAddressCharacterTool } from "./address-character";

/** The producer's one-owner semantics: the first target recorded for a turn is kept. */
function ownerRecord() {
  const targets = new Map<string, string>();
  return vi.fn((turnId: string, to: string): string | undefined => {
    const known = targets.get(turnId);
    if (known !== undefined) return known;
    targets.set(turnId, to);
    return undefined;
  });
}

function setup(
  targets = [
    { id: "aaaa0001", name: "perlica" },
    { id: "bbbb0002", name: "shino" },
  ],
) {
  const record = ownerRecord();
  const tool = createAddressCharacterTool({
    targets: () => targets,
    record,
  });
  return { tool, record, targets };
}

describe("createAddressCharacterTool — definition", () => {
  it("lists the open presets as targets (never the bare user) read each time the schema is built, requires to alone, and carries no switch or one-way flag", () => {
    const targets = [{ id: "aaaa0001", name: "perlica" }];
    const { tool } = setup(targets);
    const to = () => (tool.definition.function.parameters.properties.to as { enum: string[] }).enum;

    expect(to()).toEqual(["perlica"]);
    targets.push({ id: "bbbb0002", name: "shino" });
    expect(to()).toEqual(["perlica", "shino"]);
    expect(tool.definition.function.description).toBe(
      "Speak to another character: name who this reply is for. They hear this reply and may answer. " +
        "With handoff, this reply passes the user's message on this turn to that character, who takes it and answers the user. " +
        "Use handoff when the user's message is better answered by that character. " +
        "Once per reply; leave it out when you are talking to the user.",
    );
    expect(tool.definition.function.parameters.properties.handoff).toEqual({
      type: "boolean",
      description:
        "true: pass the user's message on this turn to that character, who answers the user.",
    });
    expect(tool.definition.function.parameters.required).toEqual(["to"]);
    expect(tool.definition.function.parameters.additionalProperties).toBe(false);
    expect(tool.switch).toBeUndefined();
    expect(tool.oneWay).toBeUndefined();
  });
});

describe("createAddressCharacterTool — execute", () => {
  it("answers error: unknown target for a label that is not an open preset", async () => {
    const { tool, record } = setup();

    expect(await tool.execute({ to: "nobody" })).toBe("error: unknown target");
    expect(record).not.toHaveBeenCalled();
  });

  it.each([false, true])("records the target and handoff=%s on the first call", async (handoff) => {
    const { tool, record } = setup();

    expect(await tool.execute({ to: "perlica", handoff }, undefined, { turnId: "t1" })).toBe("ok");
    expect(record).toHaveBeenCalledExactlyOnceWith("t1", "aaaa0001", handoff);
  });

  it.each([
    "perlica",
    "shino",
  ])("answers the kept preset's label, not the second call's target, on a second call naming %s", async (to) => {
    const { tool } = setup();

    expect(await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" })).toBe("ok");
    expect(await tool.execute({ to }, undefined, { turnId: "t1" })).toBe(
      "ignored: already addressed perlica",
    );
  });

  it("falls back to the kept id when its preset is gone from the targets", async () => {
    const { tool, record } = setup();

    expect(await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" })).toBe("ok");
    record.mockImplementationOnce(() => "cccc0009");
    expect(await tool.execute({ to: "shino" }, undefined, { turnId: "t1" })).toBe(
      "ignored: already addressed cccc0009",
    );
  });

  it("records again in another turn", async () => {
    const { tool, record } = setup();

    await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" });
    await tool.execute({ to: "shino" }, undefined, { turnId: "t2" });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith("t2", "bbbb0002", false);
  });
});
