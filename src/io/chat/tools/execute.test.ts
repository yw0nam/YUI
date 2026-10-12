/**
 * execute.test.ts — the one bounded execute both the request transports and the push consumer use.
 *
 * A call resolves with the tool's own result, the tool's timeout word when its wait passes, or an
 * error: string when it throws. The underlying execution is never cancelled.
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

  it("resolves the bare word timeout when a tool with timeoutResult outlives its wait", async () => {
    const pending = executeClientTool(
      tool({ timeoutResult: "timeout", execute: () => new Promise<string>(() => {}) }),
      {},
    );
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe("timeout");
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
        timeoutResult: "timeout",
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
