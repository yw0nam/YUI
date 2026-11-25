import { type QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HostApi, runScript } from "./sandbox";

const run = (code: string, yui: HostApi = {}, signal = new AbortController().signal) =>
  runScript(code, { yui, help: () => "help text" }, signal);

/** A host function whose Promise the test settles, and a Promise that resolves when it is called. */
function pendingCall() {
  let onCalled!: () => void;
  const called = new Promise<void>((r) => {
    onCalled = r;
  });
  let settle: (v: unknown) => void = () => {};
  const fn = () =>
    new Promise((resolve) => {
      settle = resolve;
      onCalled();
    });
  return { fn, called, settle: (v: unknown) => settle(v) };
}

function lastRuntime(spy: { mock: { results: { value: unknown }[] } }) {
  return spy.mock.results.at(-1)?.value as QuickJSRuntime | undefined;
}

describe("runScript", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["return 1+1", 2],
    ["return await Promise.resolve(1)", 1],
    ["return help()", "help text"],
    ["return await yui.settings.read()", { theme: "dawn" }],
    ["return await yui.echo({ a: [1, 2] }, 3)", [{ a: [1, 2] }, 3]],
    [
      "return [typeof fetch, typeof window, typeof document, typeof setTimeout]",
      ["undefined", "undefined", "undefined", "undefined"],
    ],
  ])("runs `%s` to its return value", async (code, result) => {
    const yui: HostApi = {
      settings: { read: async () => ({ theme: "dawn" }) },
      echo: async (...args: unknown[]) => args,
    };
    expect(await run(code, yui)).toEqual({ status: "completed", result, logs: [] });
  });

  it("collects console.log lines", async () => {
    expect(await run('console.log("hi", 1, { a: true }); console.log("two"); return null')).toEqual(
      {
        status: "completed",
        result: null,
        logs: ['hi 1 {"a":true}', "two"],
      },
    );
  });

  it("counts only the time QuickJS runs against the CPU budget", async () => {
    vi.useFakeTimers();
    const slow = pendingCall();
    const result = runScript(
      "return await yui.slow()",
      { yui: { slow: slow.fn }, help: () => "" },
      new AbortController().signal,
      { cpuMs: 200 },
    );
    await Promise.race([slow.called, result]);
    setTimeout(() => slow.settle("late"), 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ status: "completed", result: "late", logs: [] });
  });

  it.each([
    ["await new Promise(() => {})", "the script awaited something that never settles"],
    ["const f = () => f(); f()", "InternalError: stack overflow"],
    ["return new ArrayBuffer(40e6).byteLength", "InternalError: out of memory"],
    ["await yui.fail()", "Error: nope"],
    ['return "x".repeat(70000)', "result too large"],
    ['for (let i = 0; i < 100; i++) console.log("x".repeat(1000))', "result too large"],
  ])("ends `%s` with an error and disposes the runtime", async (code, error) => {
    const spy = vi.spyOn(QuickJSWASMModule.prototype, "newRuntime");
    const yui: HostApi = {
      fail: async () => {
        throw new Error("nope");
      },
    };
    expect(await run(code, yui)).toMatchObject({ status: "error", error });
    expect(lastRuntime(spy)?.alive).toBe(false);
  });

  it("interrupts an endless loop once the CPU budget is spent", async () => {
    const started = performance.now();
    const result = await runScript(
      "while (true) {}",
      { yui: {}, help: () => "" },
      new AbortController().signal,
      { cpuMs: 100 },
    );
    expect(result).toEqual({
      status: "error",
      error: "the script used more than 100 ms of CPU",
      logs: [],
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("ends with stopped on abort mid host call and ignores the late settlement", async () => {
    const spy = vi.spyOn(QuickJSWASMModule.prototype, "newRuntime");
    const hang = pendingCall();
    const controller = new AbortController();
    const result = runScript(
      "return await yui.hang()",
      { yui: { hang: hang.fn }, help: () => "" },
      controller.signal,
    );
    await Promise.race([hang.called, result]);
    controller.abort();
    expect(await result).toEqual({ status: "error", error: "stopped", logs: [] });
    hang.settle("late");
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRuntime(spy)?.alive).toBe(false);
  });
});
