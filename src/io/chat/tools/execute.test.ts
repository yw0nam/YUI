/**
 * execute.test.ts — the one bounded execute both the request transports and the push consumer use.
 *
 * A call resolves with the tool's own result, the tool's timeout result when its wait passes, or an
 * error: string when it throws. The execution's signal aborts at the wait and when the caller's
 * signal aborts; the underlying execution is never stopped by the client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientTool } from "./client-tools";
import { executeClientTool } from "./execute";

function tool(over: Partial<ClientTool> = {}): ClientTool {
  return {
    name: "slow_tool",
    definition: {
      type: "function",
      function: {
        name: "slow_tool",
        description: "dummy",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    execute: async () => "ok",
    waitMs: 2000,
    ...over,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("executeClientTool", () => {
  it("resolves the tool's result when it lands inside the wait", async () => {
    const pending = executeClientTool(tool(), {});
    await vi.advanceTimersByTimeAsync(1999);
    await expect(pending).resolves.toBe("ok");
  });

  it("leaves no timer pending once the tool has answered", async () => {
    await executeClientTool(tool(), {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves the tool's timeout result for the call's arguments when it outlives its wait", async () => {
    const pending = executeClientTool(
      tool({
        timeoutResult: (args) => `unknown: ${String(args.action)}`,
        execute: () => new Promise<string>(() => {}),
      }),
      { action: "open" },
    );
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe("unknown: open");
  });

  it("aborts the execution's signal when the wait passes", async () => {
    let seen: AbortSignal | undefined;
    const pending = executeClientTool(
      tool({
        execute: (_args, signal) => {
          seen = signal;
          return new Promise<string>(() => {});
        },
      }),
      {},
    );
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(seen?.aborted).toBe(true);
  });

  it("aborts the execution's signal when the caller's signal aborts", async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = executeClientTool(
      tool({
        execute: (_args, signal) => {
          seen = signal;
          return new Promise<string>((resolve) =>
            signal?.addEventListener("abort", () => resolve("cancelled: nothing ran")),
          );
        },
      }),
      {},
      caller.signal,
    );
    caller.abort();
    await expect(pending).resolves.toBe("cancelled: nothing ran");
    expect(seen?.aborted).toBe(true);
  });

  it("resolves an error string naming the seconds when a query outlives its wait", async () => {
    const pending = executeClientTool(
      tool({ waitMs: 7000, execute: () => new Promise<string>(() => {}) }),
      {},
    );
    await vi.advanceTimersByTimeAsync(7000);
    await expect(pending).resolves.toBe("error: timed out after 7 s");
  });

  it("resolves error: <message> when the tool throws", async () => {
    const pending = executeClientTool(
      tool({
        execute: async () => {
          throw new Error("no window");
        },
      }),
      {},
    );
    await expect(pending).resolves.toBe("error: no window");
  });

  it("leaves the underlying execution running past the timeout", async () => {
    let released: ((value: string) => void) | undefined;
    const pending = executeClientTool(
      tool({
        timeoutResult: () => "timeout",
        execute: () =>
          new Promise<string>((r) => {
            released = r;
          }),
      }),
      {},
    );
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe("timeout");
    released?.("late ok");
  });
});

it("passes an image result through unchanged", async () => {
  const result = { text: "screenshot of display 0", images: ["data:image/jpeg;base64,YQ=="] };
  await expect(executeClientTool(tool({ execute: async () => result }), {})).resolves.toBe(result);
});
