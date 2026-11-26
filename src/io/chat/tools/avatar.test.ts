/**
 * avatar.test.ts — the body_action tool and the yui.look namespace the backend model reaches.
 *
 * body_action is a thin adapter: the schema speaks the model's words, execute hands the arguments
 * to the avatar executor and renders its verdict as the tool's result string.
 */

import { describe, expect, it, vi } from "vitest";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { ScreenCapture } from "../../window/capture/screenshot-context";
import { createAvatarTools, createLookApi } from "./avatar";
import type { ClientTool } from "./client-tools";
import { runNamespace } from "./run/namespace-test-run";

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

describe("createAvatarTools", () => {
  it("declares body_action alone", () => {
    expect(createAvatarTools(() => null).map((tool) => tool.name)).toEqual(["body_action"]);
  });
});

describe("body_action — schema", () => {
  const tool = createBodyActionTool(() => null);

  it("tells the model to read perch targets and the body through yui.look", () => {
    const description = tool.definition.function.description;
    expect(description).toContain("yui.look.perch_targets()");
    expect(description).toContain("yui.look.body()");
  });

  it("is a function tool named body_action whose parameters carry every move and its field", () => {
    expect(tool.definition.function.name).toBe("body_action");
    expect(tool.definition.function.description).toMatch(/sit_on_window/);
    expect(tool.definition.function.description).toMatch(/peek/);
    expect(tool.definition.function.description).toMatch(/move_to/);
    expect(tool.definition.function.description).toMatch(/stand/);
    expect(tool.definition.function.description).not.toMatch(/\bbed\b|go_to_bed/);
    expect(tool.definition.function.description).toMatch(/timeout/);
    expect(tool.definition.function.description).toMatch(/look/);

    const props = tool.definition.function.parameters.properties;
    expect(props.action).toMatchObject({
      type: "string",
      enum: ["sit_on_window", "peek", "move_to", "stand"],
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
    expect(tool.timeoutResult?.({})).toBe("timeout");
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

describe("yui.look screen geometry", () => {
  const signal = new AbortController().signal;

  function screenMethod(
    allowRequests = true,
    capture = vi.fn(
      async (): Promise<ScreenCapture | null> => ({ data_url: "data:image/jpeg;base64,YQ==" }),
    ),
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
    const { methods } = createLookApi(() => executor(), ports);
    return { screen: (monitor?: unknown) => methods.screen(signal, monitor), capture };
  }

  it("screen without monitor captures the centre of a window on the overlapping external display", async () => {
    const { screen, capture } = screenMethod();
    await expect(screen()).resolves.toEqual({
      text: "screenshot of display 1",
      images: ["data:image/jpeg;base64,YQ=="],
    });
    expect(capture).toHaveBeenCalledWith({ x: 1750, y: 300 });
  });

  it("screen without monitor divides a built-in window centre by the window scale", async () => {
    const { screen, capture } = screenMethod(true, undefined, {
      window: pet(1000, 200, 600, 800, 2),
    });
    await expect(screen()).resolves.toMatchObject({ text: "screenshot of display 0" });
    expect(capture).toHaveBeenCalledWith({ x: 650, y: 300 });
  });

  it("screen follows the window centre when the corner lies on the other display", async () => {
    const { screen, capture } = screenMethod(true, undefined, {
      window: pet(1450, 100, 300, 400, 1),
    });
    await expect(screen()).resolves.toMatchObject({ text: "screenshot of display 1" });
    expect(capture).toHaveBeenCalledWith({ x: 1600, y: 300 });
  });

  it("screen rounds a half-pixel centre to whole coordinates", async () => {
    const { screen, capture } = screenMethod(true, undefined, {
      window: pet(1600, 100, 301, 401, 1),
    });
    await expect(screen()).resolves.toMatchObject({ text: "screenshot of display 1" });
    expect(capture).toHaveBeenCalledWith({ x: 1751, y: 301 });
  });

  it.each([
    [0, { x: 756, y: 491 }],
    [1, { x: 2472, y: 540 }],
  ])("screen with monitor %i captures that display's logical centre and names it", async (monitor, point) => {
    const { screen, capture } = screenMethod();
    await expect(screen(monitor)).resolves.toEqual({
      text: `screenshot of display ${monitor}`,
      images: ["data:image/jpeg;base64,YQ=="],
    });
    expect(capture).toHaveBeenCalledWith(point);
  });

  it("screen passes physical points unchanged when points are not logical", async () => {
    const { screen, capture } = screenMethod(true, undefined, {
      monitors: WINDOWS_MONITORS,
      window: pet(4000, 100, 450, 600, 1.5),
      pointsAreLogical: false,
    });
    await expect(screen()).resolves.toMatchObject({ text: "screenshot of display 1" });
    expect(capture).toHaveBeenCalledWith({ x: 4225, y: 400 });
    await screen(1);
    expect(capture).toHaveBeenLastCalledWith({ x: 5280, y: 810 });
  });

  it.each([
    null,
    new Error("capture denied"),
  ])("screen capture failure returns an error string: %s", async (result) => {
    const capture = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const { screen } = screenMethod(true, capture);
    await expect(screen()).resolves.toMatch(/^error:/);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("yui.look", () => {
  const signal = new AbortController().signal;
  const shot = async (): Promise<ScreenCapture> => ({ data_url: "data:image/jpeg;base64,YQ==" });

  function screenPorts(
    over: { allowRequests?: boolean; capture?: () => Promise<ScreenCapture | null> } = {},
  ) {
    return {
      allowRequests: () => over.allowRequests ?? true,
      getWindow: () => pet(1600, 100, 300, 400, 1),
      listMonitors: async () => MAC_MONITORS,
      pointsAreLogical: true,
      capturer: { captureAt: over.capture ?? shot },
    };
  }

  it("pins the help block to the spec's look declaration, with no trailing newline", () => {
    expect(createLookApi(() => null).declaration).toBe(`  look: {
    /** Her posture, window origin and monitor, loaded body, and whether a move runs. */
    body(): Promise<{ position: { x: number; y: number; monitor: number | null } | null; posture: string; vrm: { id: string; label: string } | null; moving: boolean } | "error: unsupported">;
    /** Windows she can sit on and the sides of the frontmost window she can peek from. */
    perch_targets(): Promise<{ windows: { app: string | null; title: string | null; rect: { x: number; y: number; width: number; height: number } }[]; edges: ("left" | "right")[] } | "error: unsupported">;
    /** A screenshot of the display she is on, or of display monitor (yui.info.read().monitors). Needs privacy.screen_requests. */
    screen(monitor?: number): Promise<{ text: string; images: ImageHandle[] } | \`error: \${string}\`>;
  };`);
  });

  it.each([
    [
      "body",
      {
        position: { x: 520, y: 740, monitor: 0 },
        posture: { state: "standing" },
        vrm: { id: "carlotta", label: "Carlotta" },
        moving: false,
      },
    ],
    [
      "perch_targets",
      {
        windows: [
          { app: "Notes", title: "Shopping", rect: { x: 40, y: 50, width: 300, height: 200 } },
        ],
        edges: ["left", "right"],
      },
    ],
  ])("%s returns the executor's object, not JSON text", async (method, expected) => {
    const { methods } = createLookApi(() => executor());
    const read = methods[method as "body" | "perch_targets"];
    await expect(read(signal)).resolves.toEqual(expected);
  });

  it.each([
    "body",
    "perch_targets",
  ])("%s answers error: unsupported with no executor", async (method) => {
    const { methods } = createLookApi(() => null);
    await expect(methods[method as "body" | "perch_targets"](signal)).resolves.toBe(
      "error: unsupported",
    );
  });

  it("answers error: <message> when the executor read rejects", async () => {
    const { methods } = createLookApi(() =>
      executor({
        state: vi.fn(async () => {
          throw new Error("ipc failed");
        }),
      }),
    );
    await expect(methods.body(signal)).resolves.toBe("error: ipc failed");
  });

  it("screen answers error: screen capture is off while the permission is off", async () => {
    const capture = vi.fn(shot);
    const { methods } = createLookApi(
      () => executor(),
      screenPorts({ allowRequests: false, capture }),
    );
    await expect(methods.screen(signal)).resolves.toBe("error: screen capture is off");
    expect(capture).not.toHaveBeenCalled();
  });

  it("screen answers error: unsupported with no screen port", async () => {
    const { methods } = createLookApi(() => executor());
    await expect(methods.screen(signal)).resolves.toBe("error: unsupported");
  });

  it("screen returns the screenshot text and its image", async () => {
    const { methods } = createLookApi(() => executor(), screenPorts());
    await expect(methods.screen(signal)).resolves.toEqual({
      text: "screenshot of display 1",
      images: ["data:image/jpeg;base64,YQ=="],
    });
  });

  it("screen(9) with two displays answers error: invalid field monitor", async () => {
    const capture = vi.fn(shot);
    const { methods } = createLookApi(() => executor(), screenPorts({ capture }));
    await expect(methods.screen(signal, 9)).resolves.toBe("error: invalid field monitor");
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    0.5,
    "1",
  ])("screen(%s) throws yui.look.screen for a monitor that is not an integer", async (monitor) => {
    const { methods } = createLookApi(() => executor(), screenPorts());
    await expect(methods.screen(signal, monitor)).rejects.toThrow(
      "yui.look.screen: monitor must be an integer",
    );
  });

  it('through the sandbox, screen("1") ends the run as an Error naming the call', async () => {
    const { methods } = createLookApi(() => executor(), screenPorts());
    const run = await runNamespace("look", methods, 'return await yui.look.screen("1")');
    expect(run).toEqual({
      status: "error",
      error: "Error: yui.look.screen: monitor must be an integer",
      logs: [],
    });
  });

  it("through the sandbox, screen(undefined) captures the window's display", async () => {
    const { methods } = createLookApi(() => executor(), screenPorts());
    const run = await runNamespace("look", methods, "return await yui.look.screen(undefined)");
    expect(run).toEqual({
      status: "completed",
      result: { text: "screenshot of display 1", images: ["data:image/jpeg;base64,YQ=="] },
      logs: [],
    });
  });
});
