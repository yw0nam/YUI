/**
 * avatar.test.ts — the body_action and look tools the backend model calls.
 *
 * They are thin adapters: the schema speaks the avatar Mod's words, execute hands the arguments
 * to the avatar executor and renders its verdict as the tool's result string.
 */

import { describe, expect, it, vi } from "vitest";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import { createBodyActionTool, createLookTool } from "./avatar";

function executor(over: Partial<AvatarExecutor> = {}): AvatarExecutor {
  const base = {
    command: vi.fn(async () => ({ ok: true }) as const),
    state: vi.fn(async () => ({
      position: { x: 520, y: 740, monitor: 0 },
      posture: { state: "standing" },
      vrm: { id: "carlotta", label: "Carlotta" },
      moving: false,
    })),
    perchTargets: vi.fn(async () => ({
      windows: [
        { app: "Notes", title: "Shopping", rect: { x: 40, y: 50, width: 300, height: 200 } },
      ],
      edges: ["left", "right"],
    })),
  };
  return { ...base, ...over } as AvatarExecutor;
}

describe("body_action — schema", () => {
  const tool = createBodyActionTool(() => null);

  it("is a function tool named body_action whose parameters carry every move and its field", () => {
    expect(tool.definition.function.name).toBe("body_action");
    expect(tool.definition.function.description).toMatch(/sit_on_window/);
    expect(tool.definition.function.description).toMatch(/peek/);
    expect(tool.definition.function.description).toMatch(/move_to/);
    expect(tool.definition.function.description).toMatch(/stand/);
    expect(tool.definition.function.description).toMatch(/go_to_bed/);
    expect(tool.definition.function.description).toMatch(/timeout/);
    expect(tool.definition.function.description).toMatch(/look/);

    const props = tool.definition.function.parameters.properties;
    expect(props.action).toMatchObject({
      type: "string",
      enum: ["sit_on_window", "peek", "move_to", "stand", "go_to_bed"],
    });
    expect(props.app).toMatchObject({ type: "string" });
    expect(props.side).toMatchObject({ type: "string", enum: ["left", "right"] });
    expect(props.spot).toMatchObject({
      type: "string",
      enum: ["center", "top-left", "top-right", "bottom-left", "bottom-right"],
    });
    expect(props.monitor).toMatchObject({ type: "integer" });
  });

  it("requires only action and refuses extra properties", () => {
    expect(tool.definition.function.parameters.required).toEqual(["action"]);
    expect(tool.definition.function.parameters.additionalProperties).toBe(false);
  });

  it("waits 15 s for the move and reports a passing wait as the bare word timeout", () => {
    expect(tool.waitMs).toBe(15000);
    expect(tool.timeoutResult).toBe("timeout");
    expect(tool.push).toBe(true);
    expect(tool.oneWay).toBeUndefined();
  });
});

describe("body_action — execute", () => {
  it("resolves ok when the move happened", async () => {
    const exec = executor();
    const tool = createBodyActionTool(() => exec);
    await expect(tool.execute({ action: "stand" })).resolves.toBe("ok");
    expect(exec.command).toHaveBeenCalledWith({ action: "stand" });
  });

  it("resolves the executor's failure word", async () => {
    const tool = createBodyActionTool(() =>
      executor({ command: vi.fn(async () => ({ ok: false, reason: "busy" }) as const) }),
    );
    await expect(tool.execute({ action: "move_to", spot: "center" })).resolves.toBe("busy");
  });

  it("resolves the missing field the executor names", async () => {
    const tool = createBodyActionTool(() =>
      executor({ command: vi.fn(async () => ({ error: "missing field app" })) }),
    );
    await expect(tool.execute({ action: "sit_on_window" })).resolves.toBe(
      "error: missing field app",
    );
  });

  it("resolves unsupported when no executor exists yet", async () => {
    const tool = createBodyActionTool(() => null);
    await expect(tool.execute({ action: "stand" })).resolves.toBe("unsupported");
  });
});

describe("look — schema and execute", () => {
  it("requires at and declares the two read targets", () => {
    const tool = createLookTool(() => null);
    expect(tool.definition.function.name).toBe("look");
    expect(tool.definition.function.parameters.required).toEqual(["at"]);
    expect(tool.definition.function.parameters.properties.at).toMatchObject({
      type: "string",
      enum: ["body", "perch_targets"],
    });
    expect(tool.waitMs).toBe(2000);
    expect(tool.push).toBe(true);
    expect(tool.timeoutResult).toBeUndefined();
  });

  it("at: body answers the state as a JSON string", async () => {
    const exec = executor();
    const tool = createLookTool(() => exec);
    const result = await tool.execute({ at: "body" });
    expect(JSON.parse(result)).toEqual(await exec.state());
  });

  it("at: perch_targets answers the perch candidates as a JSON string", async () => {
    const exec = executor();
    const tool = createLookTool(() => exec);
    const result = await tool.execute({ at: "perch_targets" });
    expect(JSON.parse(result)).toEqual(await exec.perchTargets());
  });

  it("answers error: unsupported when no executor exists yet", async () => {
    const tool = createLookTool(() => null);
    await expect(tool.execute({ at: "body" })).resolves.toBe("error: unsupported");
  });
});
