import { describe, expect, it, vi } from "vitest";
import { createAddressCharacterTool } from "./address-character";

function setup(targets = [{ id: "aaaa0001", name: "perlica" }]) {
  const record = vi.fn();
  const tool = createAddressCharacterTool({
    targets: () => targets,
    record,
  });
  return { tool, record };
}

describe("createAddressCharacterTool — definition", () => {
  it("lists the open presets as targets and never the bare user, read each time the schema is built", () => {
    const targets = [{ id: "aaaa0001", name: "perlica" }];
    const { tool } = setup(targets);
    const to = () =>
      (tool.definition.function.parameters.properties.to as { enum: string[] }).enum;

    expect(to()).toEqual(["perlica"]);
    targets.push({ id: "bbbb0002", name: "shino" });
    expect(to()).toEqual(["perlica", "shino"]);
  });

  it("requires to and allows no other field", () => {
    const { tool } = setup();
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

  it("records (turnId, id) on the first call and answers ok", async () => {
    const { tool, record } = setup();

    expect(await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" })).toBe("ok");
    expect(record).toHaveBeenCalledExactlyOnceWith("t1", "aaaa0001");
  });

  it("answers ignored on a second call in the same turn and records nothing more", async () => {
    const { tool, record } = setup();

    await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" });
    expect(await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" })).toBe(
      "ignored: already addressed perlica this turn",
    );
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("records again in another turn", async () => {
    const { tool, record } = setup();

    await tool.execute({ to: "perlica" }, undefined, { turnId: "t1" });
    await tool.execute({ to: "perlica" }, undefined, { turnId: "t2" });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith("t2", "aaaa0001");
  });
});
