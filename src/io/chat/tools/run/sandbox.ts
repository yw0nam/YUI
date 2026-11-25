/**
 * Runs a backend script in a fresh QuickJS module: the code is the body of an async function, its
 * globals are the host's `yui` API, `help()` and `console.log`, and nothing else reaches the client.
 */

import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";

export type RunResult =
  | { status: "completed"; result: unknown; logs: string[] }
  | { status: "error"; error: string; logs: string[] };

/** Async functions take and return JSON values; a nested object becomes a nested namespace. */
export type HostApi = { [name: string]: ((...args: unknown[]) => Promise<unknown>) | HostApi };

export interface ScriptHost {
  yui: HostApi;
  help(): string;
}

export interface RunLimits {
  cpuMs?: number;
  stackBytes?: number;
  /** The JSON length of every log line and the result, together. */
  outputChars?: number;
}

type Outcome = { result: unknown } | { error: string };

const DEFAULT_LIMITS = {
  cpuMs: 1000,
  // A 1 MiB stack crashes runtime dispose on Node 22.19 after a host RangeError (measured).
  stackBytes: 256 * 1024,
  outputChars: 64 * 1024,
};

const NEVER_SETTLES = "the script awaited something that never settles";
const TOO_LARGE = "result too large";
const HOST_NOT_JSON = "a host function returned a value that is not JSON";

// JSON, Error and AsyncFunction are captured before the script runs; a script that replaces String or Array methods only garbles its own output.
const HELPERS = `((stringify, parse, Err, AsyncFunction) => ({
  stringify,
  parse,
  AsyncFunction,
  args: (...a) => stringify(a),
  line: (...a) => a.map((v) => (typeof v === "string" ? v : String(stringify(v)))).join(" "),
  describe: (e) => (e instanceof Err ? e.name + ": " + e.message : String(e)),
}))(JSON.stringify, JSON.parse, Error, (async () => {}).constructor)`;
const HELPER_NAMES = ["stringify", "parse", "AsyncFunction", "args", "line", "describe"] as const;

export async function runScript(
  code: string,
  host: ScriptHost,
  signal: AbortSignal,
  limits: RunLimits = {},
): Promise<RunResult> {
  const { cpuMs, stackBytes, outputChars } = { ...DEFAULT_LIMITS, ...limits };
  const logs: string[] = [];
  let QuickJS: QuickJSWASMModule;
  try {
    // A module and a 64 MiB heap per run: setMemoryLimit bounds only one allocation in this build.
    const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: 1024 });
    QuickJS = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, { wasmMemory }));
  } catch (error) {
    return { status: "error", error: `the sandbox failed to load: ${error}`, logs };
  }
  if (signal.aborted) return { status: "error", error: "stopped", logs };

  const runtime = QuickJS.newRuntime();
  runtime.setMaxStackSize(stackBytes);
  const context = runtime.newContext();
  const cpuError = `the script used more than ${cpuMs} ms of CPU`;
  let cpu = 0;
  let sliceStart: number | undefined;
  let output = 0;
  let tooLarge = false;
  const spent = () => cpu + (sliceStart === undefined ? 0 : performance.now() - sliceStart) > cpuMs;
  runtime.setInterruptHandler(() => tooLarge || spent());
  const collect = (json: string) => {
    output += json.length;
    tooLarge ||= output > outputChars;
    return !tooLarge;
  };

  const helper = {} as Record<(typeof HELPER_NAMES)[number], QuickJSHandle>;
  const pending = new Set<QuickJSDeferredPromise>();
  let outer: QuickJSHandle | undefined;
  let done = false;

  // Each of these runs inside a slice: it can run guest code.
  const fail = (handle: QuickJSHandle): Outcome => {
    if (spent()) {
      handle.dispose();
      return { error: cpuError };
    }
    const text = context.callFunction(helper.describe, context.undefined, handle);
    handle.dispose();
    if (text.error) {
      text.error.dispose();
      return { error: spent() ? cpuError : "the script threw a value that cannot be read" };
    }
    const error = context.getString(text.value);
    text.value.dispose();
    return { error };
  };
  const complete = (handle: QuickJSHandle): Outcome => {
    const json = context.callFunction(helper.stringify, context.undefined, handle);
    if (json.error) return fail(json.error);
    const text = context.typeof(json.value) === "string" ? context.getString(json.value) : "null";
    json.value.dispose();
    return collect(text) ? { result: JSON.parse(text) } : { error: TOO_LARGE };
  };
  const check = (): Outcome | undefined => {
    runtime.executePendingJobs().dispose();
    if (spent()) return { error: cpuError };
    if (tooLarge) return { error: TOO_LARGE };
    if (!outer) return undefined;
    const state = context.getPromiseState(outer);
    if (state.type === "rejected") return fail(state.error);
    if (state.type === "fulfilled") {
      const outcome = complete(state.value);
      if (!state.notAPromise) state.value.dispose();
      return outcome;
    }
    return pending.size === 0 ? { error: NEVER_SETTLES } : undefined;
  };

  return new Promise<RunResult>((finish) => {
    const end = (outcome: Outcome) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      let ended = outcome;
      try {
        for (const deferred of pending) deferred.dispose();
        outer?.dispose();
        for (const handle of Object.values(helper)) handle.dispose();
        context.dispose();
        runtime.dispose();
      } catch (error) {
        ended = { error: `the sandbox failed to clean up: ${error}` };
      }
      finish(
        "error" in ended
          ? { status: "error", error: ended.error, logs }
          : { status: "completed", result: ended.result, logs },
      );
    };
    const onAbort = () => end({ error: "stopped" });
    signal.addEventListener("abort", onAbort, { once: true });

    const advance = (work: () => Outcome | undefined) => {
      if (done) return;
      let outcome: Outcome | undefined;
      const start = performance.now();
      sliceStart = start;
      try {
        outcome = work();
      } catch (error) {
        outcome = { error: String(error) };
      } finally {
        cpu += performance.now() - start;
        sliceStart = undefined;
      }
      if (outcome) end(outcome);
    };

    const resolve = (deferred: QuickJSDeferredPromise, value: unknown): Outcome | undefined => {
      let json: string | undefined;
      try {
        json = JSON.stringify(value);
      } catch {
        return { error: HOST_NOT_JSON };
      }
      if (json === undefined) deferred.resolve();
      else {
        const text = context.newString(json);
        const parsed = context.callFunction(helper.parse, context.undefined, text);
        text.dispose();
        if (parsed.error) return fail(parsed.error);
        deferred.resolve(parsed.value);
        parsed.value.dispose();
      }
      pending.delete(deferred);
      return check();
    };
    const reject = (deferred: QuickJSDeferredPromise, reason: unknown): Outcome | undefined => {
      const error = context.newError(reason instanceof Error ? reason.message : String(reason));
      deferred.reject(error);
      error.dispose();
      pending.delete(deferred);
      return check();
    };
    const call = (fn: (...args: unknown[]) => Promise<unknown>, args: QuickJSHandle[]) => {
      const packed = context.callFunction(helper.args, context.undefined, ...args);
      if (packed.error) return packed;
      const json = context.getString(packed.value);
      packed.value.dispose();
      const deferred = context.newPromise();
      pending.add(deferred);
      Promise.resolve()
        .then(() => fn(...JSON.parse(json)))
        .then(
          (value) => advance(() => resolve(deferred, value)),
          (reason) => advance(() => reject(deferred, reason)),
        );
      return deferred.handle;
    };
    const install = (target: QuickJSHandle, api: HostApi) => {
      for (const [name, member] of Object.entries(api)) {
        const handle =
          typeof member === "function"
            ? context.newFunction(name, (...args) => call(member, args))
            : context.newObject();
        if (typeof member !== "function") install(handle, member);
        context.setProp(target, name, handle);
        handle.dispose();
      }
    };

    advance(() => {
      const helpers = context.unwrapResult(context.evalCode(HELPERS));
      for (const name of HELPER_NAMES) helper[name] = context.getProp(helpers, name);
      helpers.dispose();

      const yui = context.newObject();
      install(yui, host.yui);
      context.setProp(context.global, "yui", yui);
      yui.dispose();
      const help = context.newFunction("help", () => context.newString(host.help()));
      context.setProp(context.global, "help", help);
      help.dispose();
      const consoleObject = context.newObject();
      const log = context.newFunction("log", (...args) => {
        const line = context.callFunction(helper.line, context.undefined, ...args);
        if (line.error) return line;
        const text = context.getString(line.value);
        line.value.dispose();
        if (collect(JSON.stringify(text))) logs.push(text);
      });
      context.setProp(consoleObject, "log", log);
      context.setProp(context.global, "console", consoleObject);
      log.dispose();
      consoleObject.dispose();

      const source = context.newString(code);
      const fn = context.callFunction(helper.AsyncFunction, context.undefined, source);
      source.dispose();
      if (fn.error) return fail(fn.error);
      const called = context.callFunction(fn.value, context.undefined);
      fn.value.dispose();
      if (called.error) return fail(called.error);
      outer = called.value;
      return check();
    });
  });
}
