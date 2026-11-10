/**
 * import-gate.test.ts — one card import at a time for a settings window.
 *
 * Pins src/app/card-io/import-gate.ts: a run while one is pending answers "busy" without
 * calling its task, a rejected task frees the gate, and subscribers hear each busy change.
 */

import { describe, expect, it, vi } from "vitest";
import { createImportGate } from "./import-gate";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createImportGate", () => {
  it("answers busy without calling a second task while the first runs", async () => {
    const gate = createImportGate();
    const first = deferred<string>();
    const pending = gate.run(() => first.promise);
    const second = vi.fn(async () => "second");

    await expect(gate.run(second)).resolves.toBe("busy");
    expect(second).not.toHaveBeenCalled();
    first.resolve("first");
    await expect(pending).resolves.toBe("first");
  });

  it("a rejected task frees the gate", async () => {
    const gate = createImportGate();
    await expect(gate.run(async () => Promise.reject(new Error("import failed")))).rejects.toThrow(
      "import failed",
    );

    expect(gate.isBusy()).toBe(false);
    await expect(gate.run(async () => "next")).resolves.toBe("next");
  });

  it("subscribers hear the start and the end of a run", async () => {
    const gate = createImportGate();
    const seen: boolean[] = [];
    gate.subscribe(() => seen.push(gate.isBusy()));
    const task = deferred<void>();

    const pending = gate.run(() => task.promise);
    task.resolve();
    await pending;

    expect(seen).toEqual([true, false]);
  });
});
