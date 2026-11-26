import { type QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HostApi, type RunLimits, runScript } from "./sandbox";

const load = vi.hoisted(() => ({ fail: false }));
vi.mock("quickjs-emscripten-core", async (importOriginal) => {
  const real = await importOriginal<typeof import("quickjs-emscripten-core")>();
  return {
    ...real,
    newQuickJSWASMModuleFromVariant: (
      ...args: Parameters<typeof real.newQuickJSWASMModuleFromVariant>
    ) =>
      load.fail
        ? Promise.reject(new Error("no wasm"))
        : real.newQuickJSWASMModuleFromVariant(...args),
  };
});

const run = (code: string, yui: HostApi = {}, limits?: RunLimits) =>
  runScript(code, { yui, help: async () => "help text" }, new AbortController().signal, limits);

/** The run's result, its rejection, or "did not settle" when it is still pending after 3 s. */
const settled = (result: Promise<unknown>) =>
  Promise.race([
    result.catch((error) => `rejected: ${error}`),
    new Promise((r) => setTimeout(() => r("did not settle"), 3000)),
  ]);

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

const BIGINT = "TypeError: Do not know how to serialize a BigInt";
const SPIN = "const spin = () => { const end = Date.now() + 2500; while (Date.now() < end) {} };";

describe("runScript", () => {
  afterEach(() => {
    load.fail = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["return 1+1", 2],
    ["return await Promise.resolve(1)", 1],
    ["return help()", "help text"],
    ["return await yui.settings.read()", { theme: "dawn" }],
    ["return await yui.echo({ a: [1, 2] }, 3)", [{ a: [1, 2] }, 3]],
    ["return await yui.echo(Symbol('s'), Promise.resolve(1))", [null, {}]],
    [
      "return [typeof fetch, typeof window, typeof document, typeof setTimeout]",
      ["undefined", "undefined", "undefined", "undefined"],
    ],
  ])("runs `%s` to its return value", async (code, result) => {
    const yui: HostApi = {
      settings: { read: async () => ({ theme: "dawn" }) },
      echo: async (...args: unknown[]) => args,
    };
    expect(await settled(run(code, yui))).toEqual({ status: "completed", result, logs: [] });
  });

  it.each([
    ["a missing return", "const x = 1"],
    ["a body that is only wrapped away, with no return", "}), (() => 5), (() => {"],
  ])("answers %s with a note to end the script with return", async (_name, code) => {
    expect(await settled(run(code))).toEqual({
      status: "completed",
      result: null,
      note: "the script returned nothing; end it with return and a JSON value",
      logs: [],
    });
  });

  it("answers an explicit return null without the note", async () => {
    expect(await run("return null")).toEqual({ status: "completed", result: null, logs: [] });
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
    const result = run(
      "const v = await yui.slow(); for (let i = 0; i < 1e5; i++); return v",
      { slow: slow.fn },
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
    [
      "const a = []; for (let i = 0; i < 40; i++) a.push(new Uint8Array(4e6))",
      "InternalError: out of memory",
    ],
    ["await yui.fail()", "Error: nope"],
    ["return 1n", BIGINT],
    ["await yui.v(); return 1n", BIGINT],
    ["return await yui.echo(1n)", BIGINT],
    ["return await yui.big()", "a host function returned a value that is not JSON"],
    ['return "x".repeat(70000)', "result too large"],
    ['for (let i = 0; i < 100; i++) console.log("x".repeat(1000))', "result too large"],
    ['for (;;) console.log("x".repeat(1000))', "result too large"],
  ])("ends `%s` with an error and disposes the runtime", async (code, error) => {
    const spy = vi.spyOn(QuickJSWASMModule.prototype, "newRuntime");
    const yui: HostApi = {
      fail: async () => {
        throw new Error("nope");
      },
      v: async () => 1,
      echo: async (...args: unknown[]) => args,
      big: async () => 1n,
    };
    expect(await settled(run(code, yui))).toMatchObject({ status: "error", error });
    expect(lastRuntime(spy)?.alive).toBe(false);
  });

  it.each([
    ["return { toJSON() { spin(); return 1 } }"],
    [
      'const e = new Error("x"); Object.defineProperty(e, "message", { get() { spin(); return "x" } }); throw e',
    ],
    ['Object.defineProperty(Object.prototype, "then", { get() { spin() } }); return await yui.v()'],
  ])("counts guest code the result conversion runs in `%s` against the CPU budget", async (code) => {
    const started = performance.now();
    const result = await run(`${SPIN}\n${code}`, { v: async () => ({ ok: true }) }, { cpuMs: 100 });
    expect(result).toEqual({
      status: "error",
      error: "the script used more than 100 ms of CPU",
      logs: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("gives each run its own heap, so a run holding 48 MB does not starve another", async () => {
    const hold = pendingCall();
    const fill = "const a = []; for (let i = 0; i < 12; i++) a.push(new Uint8Array(4e6));";
    const first = run(`${fill} await yui.hold(); return a.length`, { hold: hold.fn });
    await Promise.race([hold.called, first]);
    expect(await run(`${fill} return a.length`)).toEqual({
      status: "completed",
      result: 12,
      logs: [],
    });
    hold.settle(null);
    expect(await first).toEqual({ status: "completed", result: 12, logs: [] });
  });

  it("answers an error when the sandbox fails to load", async () => {
    load.fail = true;
    await expect(run("return 1")).resolves.toEqual({
      status: "error",
      error: "the sandbox failed to load: Error: no wasm",
      logs: [],
    });
  });

  it("interrupts an endless loop once the CPU budget is spent", async () => {
    const started = performance.now();
    const result = await run("while (true) {}", {}, { cpuMs: 100 });
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
      { yui: { hang: hang.fn }, help: async () => "" },
      controller.signal,
    );
    await Promise.race([hang.called, result]);
    controller.abort();
    expect(await result).toEqual({ status: "error", error: "stopped", logs: [] });
    hang.settle("late");
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRuntime(spy)?.alive).toBe(false);
  });

  it("starts no host call the script left queued when it returned", async () => {
    const f = vi.fn(async () => 1);

    const result = await run("yui.f(); return 1", { f });
    await new Promise((r) => setTimeout(r, 0));

    expect(result).toEqual({ status: "completed", result: 1, logs: [] });
    expect(f).not.toHaveBeenCalled();
  });
});
