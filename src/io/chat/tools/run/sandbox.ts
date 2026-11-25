/**
 * Runs a backend script in a fresh QuickJS context: the code is the body of an async function, its
 * globals are the host's `yui` API, `help()` and `console.log`, and nothing else reaches the client.
 */

import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import {
  memoizePromiseFactory,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
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
  memoryBytes?: number;
  stackBytes?: number;
  /** The JSON length of every log line and the result, together. */
  outputBytes?: number;
}

const DEFAULT_LIMITS = {
  cpuMs: 1000,
  memoryBytes: 32 * 1024 * 1024,
  // 1 MiB crashed runtime dispose on Node 22.19 after a host RangeError (measured).
  stackBytes: 256 * 1024,
  outputBytes: 64 * 1024,
};

const NEVER_SETTLES = "the script awaited something that never settles";

// The wasm heap is capped at 64 MiB: setMemoryLimit bounds only a single allocation in this build.
const loadQuickJS = memoizePromiseFactory(() =>
  newQuickJSWASMModuleFromVariant(
    newVariant(releaseSync, {
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
    }),
  ),
);

export async function runScript(
  code: string,
  host: ScriptHost,
  signal: AbortSignal,
  limits: RunLimits = {},
): Promise<RunResult> {
  const { cpuMs, memoryBytes, stackBytes, outputBytes } = { ...DEFAULT_LIMITS, ...limits };
  const QuickJS = await loadQuickJS();
  const logs: string[] = [];
  if (signal.aborted) return { status: "error", error: "stopped", logs };

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryBytes);
  runtime.setMaxStackSize(stackBytes);
  let cpu = 0;
  let sliceStart: number | undefined;
  let output = 0;
  let tooLarge = false;
  runtime.setInterruptHandler(
    () => tooLarge || (sliceStart !== undefined && cpu + performance.now() - sliceStart > cpuMs),
  );
  const inQuickJS = <T>(run: () => T): T => {
    const start = performance.now();
    sliceStart = start;
    try {
      return run();
    } finally {
      cpu += performance.now() - start;
      sliceStart = undefined;
    }
  };
  const collect = (json: string) => {
    output += json.length;
    tooLarge ||= output > outputBytes;
    return !tooLarge;
  };

  const context = runtime.newContext();
  const pending = new Set<QuickJSDeferredPromise>();
  const jsonParse = context.unwrapResult(context.evalCode("JSON.parse"));
  let outer: QuickJSHandle | undefined;
  let done = false;

  const errorText = (handle: QuickJSHandle) => {
    const error = context.dump(handle);
    return error && typeof error === "object" && "message" in error
      ? `${error.name}: ${error.message}`
      : String(error);
  };
  const toGuest = (value: unknown): QuickJSHandle => {
    const json = JSON.stringify(value);
    if (json === undefined) return context.undefined;
    const text = context.newString(json);
    const parsed = context.callFunction(jsonParse, context.undefined, text);
    text.dispose();
    return context.unwrapResult(parsed);
  };

  return new Promise<RunResult>((finish) => {
    const end = (outcome: { result: unknown } | { error: string }) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      for (const deferred of pending) deferred.dispose();
      outer?.dispose();
      jsonParse.dispose();
      context.dispose();
      runtime.dispose();
      finish(
        "error" in outcome
          ? { status: "error", error: outcome.error, logs }
          : { status: "completed", result: outcome.result, logs },
      );
    };
    const onAbort = () => end({ error: "stopped" });
    signal.addEventListener("abort", onAbort, { once: true });

    const step = (handle: QuickJSHandle) => {
      inQuickJS(() => runtime.executePendingJobs()).dispose();
      if (tooLarge) return end({ error: "result too large" });
      const cpuError = `the script used more than ${cpuMs} ms of CPU`;
      const state = context.getPromiseState(handle);
      if (state.type === "fulfilled") {
        const result = context.dump(state.value);
        state.value.dispose();
        return end(
          collect(JSON.stringify(result) ?? "") ? { result } : { error: "result too large" },
        );
      }
      if (state.type === "rejected") {
        const error = errorText(state.error);
        state.error.dispose();
        return end({ error: cpu > cpuMs ? cpuError : error });
      }
      if (cpu > cpuMs) return end({ error: cpuError });
      if (pending.size === 0) end({ error: NEVER_SETTLES });
    };

    const settle = (
      deferred: QuickJSDeferredPromise,
      outcome: { value: unknown } | { error: unknown },
    ) => {
      if (done) return;
      pending.delete(deferred);
      try {
        if ("value" in outcome) {
          const value = toGuest(outcome.value);
          deferred.resolve(value);
          value.dispose();
        } else {
          const message =
            outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
          const error = context.newError(message);
          deferred.reject(error);
          error.dispose();
        }
      } catch (error) {
        return end({ error: String(error) });
      }
      if (outer) step(outer);
    };
    const call = (fn: (...args: unknown[]) => Promise<unknown>, args: unknown[]) => {
      const deferred = context.newPromise();
      pending.add(deferred);
      Promise.resolve()
        .then(() => fn(...args))
        .then(
          (value) => settle(deferred, { value }),
          (error) => settle(deferred, { error }),
        );
      return deferred.handle;
    };
    const install = (target: QuickJSHandle, api: HostApi) => {
      for (const [name, member] of Object.entries(api)) {
        const handle =
          typeof member === "function"
            ? context.newFunction(name, (...args) =>
                call(
                  member,
                  args.map((arg) => context.dump(arg)),
                ),
              )
            : context.newObject();
        if (typeof member !== "function") install(handle, member);
        context.setProp(target, name, handle);
        handle.dispose();
      }
    };

    const yui = context.newObject();
    install(yui, host.yui);
    context.setProp(context.global, "yui", yui);
    yui.dispose();
    const help = context.newFunction("help", () => context.newString(host.help()));
    context.setProp(context.global, "help", help);
    help.dispose();
    const consoleObject = context.newObject();
    const log = context.newFunction("log", (...args) => {
      const line = args
        .map((arg) => {
          const value = context.dump(arg);
          return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
        })
        .join(" ");
      if (collect(JSON.stringify(line))) logs.push(line);
    });
    context.setProp(consoleObject, "log", log);
    context.setProp(context.global, "console", consoleObject);
    log.dispose();
    consoleObject.dispose();

    const evaluated = inQuickJS(() => context.evalCode(`(async () => {\n${code}\n})()`));
    if (evaluated.error) {
      const error = errorText(evaluated.error);
      evaluated.error.dispose();
      return end({ error });
    }
    outer = evaluated.value;
    step(outer);
  });
}
