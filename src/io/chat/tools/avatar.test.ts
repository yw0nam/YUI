/**
 * avatar.test.ts — the body_action and look tools the backend model calls.
 *
 * They are thin adapters: the schema speaks the avatar Mod's words, execute hands the arguments
 * to the avatar executor and renders its verdict as the tool's result string.
 */

import { describe, expect, it, vi } from "vitest";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { ScreenCapture } from "../../window/capture/screenshot-context";
import { createAvatarTools } from "./avatar";
import type { ClientTool } from "./client-tools";

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

const toolNamed = (name: string, getExecutor: () => AvatarExecutor | null): ClientTool =>
  createAvatarTools(getExecutor).find((tool) => tool.name === name)!;
const createBodyActionTool = (getExecutor: () => AvatarExecutor | null) =>
  toolNamed("body_action", getExecutor);
const createLookTool = (getExecutor: () => AvatarExecutor | null) => toolNamed("look", getExecutor);

describe("createAvatarTools", () => {
  it("declares body_action then look", () => {
    expect(createAvatarTools(() => null).map((tool) => tool.name)).toEqual(["body_action", "look"]);
  });
});

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

  it("counts any answer but ok as a failure", () => {
    expect(tool.failed?.("ok")).toBe(false);
    expect(tool.failed?.("busy")).toBe(true);
    expect(tool.failed?.("timeout")).toBe(true);
  });

  it("reports a passing wait as the bare word timeout", () => {
    expect(tool.timeoutResult).toBe("timeout");
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
  it("requires at and declares the three read targets", () => {
    const tool = createLookTool(() => null);
    expect(tool.definition.function.name).toBe("look");
    expect(tool.definition.function.parameters.required).toEqual(["at"]);
    expect(tool.definition.function.parameters.properties.at).toMatchObject({
      type: "string",
      enum: ["body", "perch_targets", "screen"],
    });
    expect(tool.definition.function.parameters.properties.monitor).toMatchObject({
      type: "integer",
    });
    expect(tool.waitMs).toBe(2000);
    expect(tool.timeoutResult).toBeUndefined();
  });

  it("at: body answers the state as a JSON string", async () => {
    const exec = executor();
    const tool = createLookTool(() => exec);
    const result = await tool.execute({ at: "body" });
    expect(JSON.parse(result as string)).toEqual(await exec.state());
  });

  it("at: perch_targets answers the perch candidates as a JSON string", async () => {
    const exec = executor();
    const tool = createLookTool(() => exec);
    const result = await tool.execute({ at: "perch_targets" });
    expect(JSON.parse(result as string)).toEqual(await exec.perchTargets());
  });

  it("answers error: missing field at when at is absent", async () => {
    const tool = createLookTool(() => executor());
    await expect(tool.execute({})).resolves.toBe("error: missing field at");
  });

  it("answers error: invalid field at for a target it does not know", async () => {
    const exec = executor();
    const tool = createLookTool(() => exec);
    await expect(tool.execute({ at: "apps" })).resolves.toBe("error: invalid field at");
    expect(exec.state).not.toHaveBeenCalled();
    expect(exec.perchTargets).not.toHaveBeenCalled();
  });

  it("answers error: unsupported when no executor exists yet", async () => {
    const tool = createLookTool(() => null);
    await expect(tool.execute({ at: "body" })).resolves.toBe("error: unsupported");
  });
});

describe("look — screen requests", () => {
  const bounds = (x: number, y: number, width: number, height: number, scaleFactor: number) => ({
    position: { x, y },
    size: { width, height },
    workArea: { position: { x, y }, size: { width, height } },
    scaleFactor,
  });
  // The layout tao reports on macOS: a 2x built-in and a 1x external at logical x 1512, whose
  // physical rects overlap (0..3024 and 1512..3432).
  const MAC_MONITORS = [bounds(0, 0, 3024, 1964, 2), bounds(1512, 0, 1920, 1080, 1)];
  // Physical rects as Windows reports them: the 1.5x second display starts where the first ends.
  const WINDOWS_MONITORS = [bounds(0, 0, 3840, 2160, 2), bounds(3840, 0, 2880, 1620, 1.5)];
  const pet = (x: number, y: number, width: number, height: number, scale: number) => ({
    outerPosition: async () => ({ x, y }),
    outerSize: async () => ({ width, height }),
    scaleFactor: async () => scale,
  });

  function screenTool(
    allowRequests = true,
    capture = vi.fn(
      async (): Promise<ScreenCapture | null> => ({ data_url: "data:image/jpeg;base64,YQ==" }),
    ),
    available = true,
    layout: {
      window?: ReturnType<typeof pet>;
      monitors?: ReturnType<typeof bounds>[];
      pointsAreLogical?: boolean;
    } = {},
  ) {
    const ports = {
      allowRequests: () => allowRequests,
      getWindow: () => layout.window ?? pet(1600, 100, 300, 400, 1),
      listMonitors: async () => layout.monitors ?? MAC_MONITORS,
      pointsAreLogical: layout.pointsAreLogical ?? true,
      capturer: { capture: vi.fn(), captureAt: capture },
    };
    const tool = createAvatarTools(() => (available ? executor() : null), ports).find(
      (t) => t.name === "look",
    )!;
    return { tool, capture };
  }

  it("screen permission off refuses capture and keeps the declaration", async () => {
    const { tool, capture } = screenTool(false);
    await expect(tool.execute({ at: "screen" })).resolves.toBe("error: screen capture is off");
    expect(capture).not.toHaveBeenCalled();
  });

  it("screen without monitor captures the centre of a window on the overlapping external display", async () => {
    const { tool, capture } = screenTool();
    await expect(tool.execute({ at: "screen" })).resolves.toEqual({
      text: "screenshot of display 1",
      images: ["data:image/jpeg;base64,YQ=="],
    });
    expect(capture).toHaveBeenCalledWith({ x: 1750, y: 300 });
  });

  it("screen without monitor divides a built-in window centre by the window scale", async () => {
    const { tool, capture } = screenTool(true, undefined, true, {
      window: pet(1000, 200, 600, 800, 2),
    });
    await expect(tool.execute({ at: "screen" })).resolves.toMatchObject({
      text: "screenshot of display 0",
    });
    expect(capture).toHaveBeenCalledWith({ x: 650, y: 300 });
  });

  it("screen follows the window centre when the corner lies on the other display", async () => {
    const { tool, capture } = screenTool(true, undefined, true, {
      window: pet(1450, 100, 300, 400, 1),
    });
    await expect(tool.execute({ at: "screen" })).resolves.toMatchObject({
      text: "screenshot of display 1",
    });
    expect(capture).toHaveBeenCalledWith({ x: 1600, y: 300 });
  });

  it.each([
    [0, { x: 756, y: 491 }],
    [1, { x: 2472, y: 540 }],
  ])("screen with monitor %i captures that display's logical centre and names it", async (monitor, point) => {
    const { tool, capture } = screenTool();
    await expect(tool.execute({ at: "screen", monitor })).resolves.toEqual({
      text: `screenshot of display ${monitor}`,
      images: ["data:image/jpeg;base64,YQ=="],
    });
    expect(capture).toHaveBeenCalledWith(point);
  });

  it("screen passes physical points unchanged when points are not logical", async () => {
    const { tool, capture } = screenTool(true, undefined, true, {
      monitors: WINDOWS_MONITORS,
      window: pet(4000, 100, 450, 600, 1.5),
      pointsAreLogical: false,
    });
    await expect(tool.execute({ at: "screen" })).resolves.toMatchObject({
      text: "screenshot of display 1",
    });
    expect(capture).toHaveBeenCalledWith({ x: 4225, y: 400 });
    await tool.execute({ at: "screen", monitor: 1 });
    expect(capture).toHaveBeenLastCalledWith({ x: 5280, y: 810 });
  });

  it.each([
    -1,
    2,
    0.5,
    "0",
    null,
  ])("screen rejects invalid monitor %s without capture", async (monitor) => {
    const { tool, capture } = screenTool();
    await expect(tool.execute({ at: "screen", monitor })).resolves.toBe(
      "error: invalid field monitor",
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    null,
    new Error("capture denied"),
  ])("screen capture failure returns an error string: %s", async (result) => {
    const capture = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const { tool } = screenTool(true, capture);
    await expect(tool.execute({ at: "screen" })).resolves.toMatch(/^error:/);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("screen with unavailable executor answers unsupported", async () => {
    const { tool, capture } = screenTool(true, undefined, false);
    await expect(tool.execute({ at: "screen" })).resolves.toBe("error: unsupported");
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(["body", "perch_targets"])("%s ignores monitor and screen permission", async (at) => {
    const { tool, capture } = screenTool(false);
    const result = await tool.execute({ at, monitor: "invalid" });
    expect(typeof result).toBe("string");
    expect(JSON.parse(result as string)).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();
  });
});
