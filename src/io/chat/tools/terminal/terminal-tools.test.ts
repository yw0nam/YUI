/** terminal-tools.test.ts — the five terminal tools over the terminal commands. */

import { describe, expect, it, vi } from "vitest";
import { TURN_STOPPED } from "../client-tools";
import { createTerminalTools } from "./terminal-tools";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeTools(result = "ok") {
  const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => result);
  const [open, list, read, write, close] = createTerminalTools({
    presetId: () => "yui",
    invoke,
  });
  return { invoke, open, list, read, write, close };
}

it.each([
  ["open", { cwd: "/tmp" }, ["terminal_tool_open", { presetId: "yui", cwd: "/tmp" }]],
  ["list", {}, ["terminal_tool_list"]],
  ["close", { id: "t1" }, ["terminal_tool_close", { presetId: "yui", id: "t1" }]],
] as const)("terminal_%s invokes its command with the window's preset", async (name, args, call) => {
  const { invoke, ...tools } = fakeTools("done");

  await expect(tools[name].execute(args)).resolves.toBe("done");

  expect(invoke).toHaveBeenCalledWith(...call);
});

describe("terminal_read", () => {
  it("reads with a fresh call id, the window's preset, the terminal id and lines", async () => {
    const { invoke, read } = fakeTools("screen text");

    await expect(read.execute({ id: "t1", lines: 50 })).resolves.toBe("screen text");

    const callId = invoke.mock.calls[0]![1]!.callId as string;
    expect(callId).toMatch(UUID);
    expect(invoke).toHaveBeenCalledWith("terminal_tool_read", {
      callId,
      presetId: "yui",
      id: "t1",
      lines: 50,
    });
  });

  it("cancels the call and reports the stopped turn when the signal aborts mid-call", async () => {
    const abort = new AbortController();
    let callId = "";
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "terminal_tool_cancel") return "";
      callId = String(args?.callId ?? "");
      return new Promise<string>((resolve) =>
        abort.signal.addEventListener("abort", () => resolve(TURN_STOPPED)),
      );
    });
    const [, , read] = createTerminalTools({ presetId: () => "yui", invoke });

    const running = read.execute({ id: "t1" }, abort.signal);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("terminal_tool_read", expect.anything()),
    );
    abort.abort();

    await expect(running).resolves.toBe(TURN_STOPPED);
    expect(callId).toMatch(UUID);
    expect(invoke).toHaveBeenCalledWith("terminal_tool_cancel", { callId });
  });

  it("reports the stopped turn without invoking on an already-aborted signal", async () => {
    const abort = new AbortController();
    abort.abort();
    const { invoke, read } = fakeTools();

    await expect(read.execute({ id: "t1" }, abort.signal)).resolves.toBe(TURN_STOPPED);

    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("terminal_write", () => {
  it("writes with a fresh call id, the window's preset, the terminal id, text and enter", async () => {
    const { invoke, write } = fakeTools();

    await expect(write.execute({ id: "t1", text: "ls", enter: false })).resolves.toBe("ok");

    const callId = invoke.mock.calls[0]![1]!.callId as string;
    expect(callId).toMatch(UUID);
    expect(invoke).toHaveBeenCalledWith("terminal_tool_write", {
      callId,
      presetId: "yui",
      id: "t1",
      text: "ls",
      enter: false,
    });
  });
});
