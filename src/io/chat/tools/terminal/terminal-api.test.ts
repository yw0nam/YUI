/** terminal-api.test.ts — yui.terminal over the terminal commands. */

import { describe, expect, it, vi } from "vitest";
import { runNamespace } from "../run/namespace-test-run";
import { createTerminalApi, type TerminalInvoke } from "./terminal-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeApi(result = "ok") {
  const invoke = vi.fn<TerminalInvoke>(async () => result);
  const { methods } = createTerminalApi({ presetId: () => "yui", invoke });
  return { invoke, methods, signal: new AbortController().signal };
}

it.each([
  ["open", [{ cwd: "/tmp" }], ["terminal_tool_open", { presetId: "yui", cwd: "/tmp" }]],
  ["list", [], ["terminal_tool_list"]],
  ["close", ["t1"], ["terminal_tool_close", { presetId: "yui", id: "t1" }]],
] as const)("%s invokes its command with the window's preset", async (name, args, call) => {
  const { invoke, methods, signal } = fakeApi("done");

  await expect(
    (methods[name] as (...a: unknown[]) => Promise<string>)(signal, ...args),
  ).resolves.toBe("done");

  expect(invoke).toHaveBeenCalledWith(...call);
});

describe("read", () => {
  it("reads with a fresh call id, the window's preset, the terminal id and lines", async () => {
    const { invoke, methods, signal } = fakeApi("screen text");

    await expect(methods.read(signal, "t1", { lines: 50 })).resolves.toBe("screen text");

    const callId = invoke.mock.calls[0]![1]!.callId as string;
    expect(callId).toMatch(UUID);
    expect(invoke).toHaveBeenCalledWith("terminal_tool_read", {
      callId,
      presetId: "yui",
      id: "t1",
      lines: 50,
    });
  });

  it("cancels the call by its id when the signal aborts while it waits", async () => {
    const abort = new AbortController();
    let callId = "";
    const invoke = vi.fn<TerminalInvoke>(async (command, args) => {
      if (command === "terminal_tool_cancel") return "";
      callId = String(args?.callId ?? "");
      return new Promise<string>((resolve) =>
        abort.signal.addEventListener("abort", () => resolve("error: turn stopped")),
      );
    });
    const { methods } = createTerminalApi({ presetId: () => "yui", invoke });

    const running = methods.read(abort.signal, "t1");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("terminal_tool_read", expect.anything()),
    );
    abort.abort();

    await expect(running).resolves.toBe("error: turn stopped");
    expect(callId).toMatch(UUID);
    expect(invoke).toHaveBeenCalledWith("terminal_tool_cancel", { callId });
  });

  it("answers the stopped turn and invokes nothing on an already-aborted signal", async () => {
    const abort = new AbortController();
    abort.abort();
    const { invoke, methods } = fakeApi();

    await expect(methods.read(abort.signal, "t1")).resolves.toBe("error: turn stopped");

    expect(invoke).not.toHaveBeenCalled();
  });
});

it("write passes the terminal id, text and enter with a fresh call id", async () => {
  const { invoke, methods, signal } = fakeApi();

  await expect(methods.write(signal, "t1", "ls", { enter: false })).resolves.toBe("ok");

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

it("returns the message of a rejected invoke as an error value", async () => {
  const invoke = vi.fn<TerminalInvoke>(async () => {
    throw "x";
  });
  const { methods } = createTerminalApi({ presetId: () => "yui", invoke });

  await expect(methods.list(new AbortController().signal)).resolves.toBe("error: x");
  await expect(methods.read(new AbortController().signal, "t1")).resolves.toBe("error: x");
});

describe("arguments through the sandbox", () => {
  it.each([
    ["read(5)", "read"],
    ['write("t", 5)', "write"],
    ['read("t", { lines: "x" })', "read"],
    ['read("t", { lines: 4294967296 })', "read"],
    ['read("t", { lines: -1 })', "read"],
    ['read("t", { lines: 1.5 })', "read"],
    ['write("t", "x", { enter: "no" })', "write"],
    ["open({ cwd: 5 })", "open"],
    ['read("t", "x")', "read"],
  ])("%s throws and invokes nothing", async (call, method) => {
    const { invoke, methods } = fakeApi();

    const run = await runNamespace("terminal", methods, `return await yui.terminal.${call};`);

    expect(run).toMatchObject({
      status: "error",
      error: expect.stringMatching(new RegExp(`^Error: yui\\.terminal\\.${method}:`)),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads with the default lines when opts is null", async () => {
    const { invoke, methods } = fakeApi("screen");

    const run = await runNamespace(
      "terminal",
      methods,
      'return await yui.terminal.read("t", null);',
    );

    expect(run).toMatchObject({ status: "completed", result: "screen" });
    expect(invoke).toHaveBeenCalledWith("terminal_tool_read", {
      callId: expect.stringMatching(UUID),
      presetId: "yui",
      id: "t",
      lines: undefined,
    });
  });
});

it("declares the terminal namespace's five methods", () => {
  const { declaration } = createTerminalApi({
    presetId: () => "yui",
    invoke: vi.fn<TerminalInvoke>(),
  });

  for (const method of ["open", "list", "read", "write", "close"]) {
    expect(declaration).toContain(`${method}(`);
  }
  expect(declaration.endsWith("\n")).toBe(false);
});
