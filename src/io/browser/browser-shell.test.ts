/**
 * browser-shell.test.ts — the generation protocol between an accepted browser call and the shell.
 *
 * A call forwards to `browser_run` only under the generation it was accepted in, and only while
 * that generation is still the latest one the shell acknowledged; everything else answers
 * `cancelled: nothing ran` without reaching the shell.
 */

import { describe, expect, it, vi } from "vitest";
import { createBrowserShell } from "./browser-shell";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A shell whose generation and cancel answers the test settles by hand. */
function fakeShell(now = () => 1_000) {
  const generation = deferred<number>();
  const cancels: Array<Deferred<number>> = [];
  const runs: Array<Record<string, unknown>> = [];
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "browser_generation") return generation.promise;
    if (cmd === "browser_cancel") {
      const answer = deferred<number>();
      cancels.push(answer);
      return answer.promise;
    }
    if (cmd === "browser_run") {
      runs.push(args!);
      return "snapshot";
    }
    return undefined;
  });
  const shell = createBrowserShell(invoke as never, now);
  return { shell, invoke, generation, cancels, runs };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createBrowserShell", () => {
  it("forwards a call under its generation with a deadline 30 s after acceptance", async () => {
    const { shell, generation, runs } = fakeShell();
    generation.resolve(4);
    await expect(shell.run("open", { url: "https://example.com" })).resolves.toBe("snapshot");
    expect(runs).toEqual([
      { gen: 4, deadlineAt: 31_000, action: "open", args: { url: "https://example.com" } },
    ]);
  });

  it("answers cancelled for a call accepted before a cancel", async () => {
    const { shell, generation, cancels, runs } = fakeShell();
    generation.resolve(1);
    const call = shell.run("read", {});
    shell.cancel();
    await flush();
    cancels[0].resolve(2);
    await expect(call).resolves.toBe("cancelled: nothing ran");
    expect(runs).toEqual([]);
  });

  it("runs a call accepted during a pending cancel under the new generation", async () => {
    const { shell, generation, cancels, runs } = fakeShell();
    generation.resolve(1);
    shell.cancel();
    const call = shell.run("read", {});
    await flush();
    cancels[0].resolve(2);
    await expect(call).resolves.toBe("snapshot");
    expect(runs.map((run) => run.gen)).toEqual([2]);
  });

  it("follows a barrier replaced while the call awaits it", async () => {
    const { shell, generation, cancels, runs } = fakeShell();
    generation.resolve(1);
    await flush();
    const call = shell.run("read", {});
    // Lands after the call read the barrier and before that await resumes.
    queueMicrotask(() => shell.cancel());
    await flush();
    cancels[0].resolve(2);
    await expect(call).resolves.toBe("cancelled: nothing ran");
    expect(runs).toEqual([]);
  });

  it("blocks old and new calls after a failed cancel until a later cancel is acknowledged", async () => {
    const { shell, generation, cancels, runs } = fakeShell();
    generation.resolve(1);
    const before = shell.run("read", {});
    shell.cancel();
    const during = shell.run("read", {});
    await flush();
    cancels[0].reject(new Error("shell gone"));
    await expect(before).resolves.toBe("cancelled: nothing ran");
    await expect(during).resolves.toBe("cancelled: nothing ran");

    const after = shell.run("read", {});
    await flush();
    expect(cancels).toHaveLength(2);
    cancels[1].resolve(5);
    await expect(after).resolves.toBe("snapshot");
    expect(runs.map((run) => run.gen)).toEqual([5]);
  });

  it("never reaches the shell when the deadline passes before forwarding", async () => {
    let clock = 1_000;
    const { shell, generation, runs } = fakeShell(() => clock);
    const call = shell.run("read", {});
    clock += 30_000;
    generation.resolve(1);
    await expect(call).resolves.toBe("cancelled: nothing ran");
    expect(runs).toEqual([]);
  });

  it("cancels when the call's signal aborts", async () => {
    const { shell, generation, cancels, invoke } = fakeShell();
    generation.resolve(1);
    const abort = new AbortController();
    const call = shell.run("read", {}, abort.signal);
    abort.abort();
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_cancel");
    cancels[0].resolve(2);
    await expect(call).resolves.toBe("cancelled: nothing ran");
  });

  it("stops by cancelling first, then asking the shell to stop", async () => {
    const { shell, generation, cancels, invoke } = fakeShell();
    generation.resolve(1);
    const stopped = shell.stop();
    await flush();
    cancels[0]?.resolve(2);
    await stopped;
    const commands = invoke.mock.calls.map(([cmd]) => cmd);
    expect(commands.slice(1)).toEqual(["browser_cancel", "browser_stop"]);
  });
});
