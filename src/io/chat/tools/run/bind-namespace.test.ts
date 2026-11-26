/** bind-namespace.test.ts — a bound namespace call names the status pill by its namespace, and hands its images over as handles. */

import { describe, expect, it, vi } from "vitest";
import { bindNamespace } from "./bind-namespace";
import type { YuiMethod } from "./namespace";

type Bound = (...args: unknown[]) => Promise<unknown>;

function bound(name: string, method: string, answer: unknown = "ok") {
  const status = vi.fn();
  const fn = vi.fn<YuiMethod>(async () => answer);
  const signal = new AbortController().signal;
  const api = bindNamespace(
    name,
    { methods: { [method]: fn }, declaration: "" },
    { signal, status, keep: (images) => images.map((_, i) => ({ image: i + 7 })) },
  );
  return { call: api[method] as Bound, status, fn, signal };
}

describe("bindNamespace", () => {
  it.each([
    ["look", "screen", [], [["look"]]],
    ["terminal", "read", ["t1"], [["terminal"]]],
    ["threads", "search", ["q"], [["threads"]]],
    ["plugins", "call", ["hello_tool", {}], [["hello_tool"]]],
    ["plugins", "call", [5], []],
    ["plugins", "list", [], []],
    ["guide", "read", ["controls"], []],
  ])("a call to %s.%s with %j reports %j", async (name, method, args, reports) => {
    const { call, status } = bound(name, method);

    await call(...args);

    expect(status.mock.calls).toEqual(reports);
  });

  it("hands the method the run's signal and the script's arguments", async () => {
    const { call, fn, signal } = bound("terminal", "write");

    await call("t1", "ls", null);

    expect(fn).toHaveBeenCalledWith(signal, "t1", "ls", null);
  });

  it.each([
    [
      { text: "s", images: ["data:a", "data:b"] },
      { text: "s", images: [{ image: 7 }, { image: 8 }] },
    ],
    [
      { text: "s", images: [1] },
      { text: "s", images: [1] },
    ],
    ["error: screen capture is off", "error: screen capture is off"],
  ])("answers %j as %j", async (answer, expected) => {
    const { call } = bound("look", "screen", answer);

    expect(await call()).toEqual(expected);
  });
});
