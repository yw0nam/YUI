import { describe, expect, it } from "vitest";
import { createModelRead, type ModelReadPhase } from "./model-read";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// A fetch whose responses the test resolves by hand, one per call, in call order.
function deferredFetch() {
  const resolvers: ((res: Response) => void)[] = [];
  const calls: { url: string; signal: AbortSignal }[] = [];
  const fetchImpl: typeof globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), signal: init?.signal as AbortSignal });
    return new Promise<Response>((res) => {
      resolvers.push(res);
    });
  };
  return {
    fetchImpl,
    calls,
    respond: (n: number) =>
      resolvers[n]?.(new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 })),
  };
}

function harness(
  fetchImpl: typeof globalThis.fetch,
  getApiKey: () => Promise<string | undefined> = async () => "key-1",
) {
  const phases: ModelReadPhase[] = [];
  const read = createModelRead({
    getApiKey,
    getFetch: async () => fetchImpl,
    onPhase: (phase) => phases.push(phase),
  });
  return { read, phases };
}

describe("createModelRead", () => {
  it("reuses an identical read already in flight (same URL and key)", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const { read, phases } = harness(fetchImpl);

    read.start("https://api.test/v1");
    await tick();
    read.start("https://api.test/v1");
    await tick();
    await tick();

    expect(calls).toHaveLength(1);
    expect(phases).toEqual([{ phase: "reading" }]);
  });

  it("aborts the older request when a newer one starts and reports only the newer completion", async () => {
    const { fetchImpl, calls, respond } = deferredFetch();
    const { read, phases } = harness(fetchImpl);

    read.start("https://old.test/v1");
    await tick();
    read.start("https://new.test/v1");
    await tick();
    expect(calls[0]?.signal.aborted).toBe(true);

    respond(1); // only the newer request's response applies
    await tick();
    await tick();

    expect(phases).toEqual([
      { phase: "reading" },
      { phase: "reading" },
      { phase: "done", result: { kind: "ok", ids: ["m1"] } },
    ]);
  });

  it("drops a start whose key resolved after a newer start took over", async () => {
    const { fetchImpl, calls } = deferredFetch();
    // The older start's key resolution is held back until the newer start is already reading.
    let releaseOld: ((key: string | undefined) => void) | undefined;
    let keyCalls = 0;
    const { read, phases } = harness(fetchImpl, () => {
      keyCalls += 1;
      return keyCalls === 1
        ? new Promise<string | undefined>((r) => {
            releaseOld = r;
          })
        : Promise.resolve("key-1");
    });

    read.start("https://old.test/v1");
    read.start("https://new.test/v1");
    await tick();
    expect(calls).toHaveLength(1); // only the newer start got as far as fetching
    releaseOld?.("key-1");
    await tick();
    await tick();
    expect(calls).toHaveLength(1);

    expect(phases).toEqual([{ phase: "reading" }]);
  });

  it("reports a joined read's completion and leaves the read joinable until it settles", async () => {
    const { fetchImpl, calls, respond } = deferredFetch();
    const { read, phases } = harness(fetchImpl);

    read.start("https://api.test/v1");
    await tick();
    read.start("https://api.test/v1"); // joins the identical in-flight read
    await tick();
    respond(0);
    await tick();
    await tick();

    expect(calls).toHaveLength(1);
    expect(phases).toEqual([
      { phase: "reading" },
      { phase: "done", result: { kind: "ok", ids: ["m1"] } },
    ]);
  });

  it("cancels a start suspended on its key when abort arrives first", async () => {
    const { fetchImpl, calls } = deferredFetch();
    let release!: (key: string | undefined) => void;
    const gate = new Promise<string | undefined>((r) => {
      release = r;
    });
    const { read, phases } = harness(fetchImpl, () => gate);

    read.start("https://api.test/v1");
    read.abort();
    release("key-1");
    await tick();
    await tick();

    expect(calls).toHaveLength(0);
    expect(phases).toEqual([]);
  });

  it("yields only cleared for a clear during the key await, with zero fetches", async () => {
    const { fetchImpl, calls } = deferredFetch();
    let release!: (key: string | undefined) => void;
    const gate = new Promise<string | undefined>((r) => {
      release = r;
    });
    const { read, phases } = harness(fetchImpl, () => gate);

    read.start("https://api.test/v1");
    read.clear();
    release("key-1");
    await tick();
    await tick();

    expect(calls).toHaveLength(0);
    expect(phases).toEqual([{ phase: "cleared" }]);
  });

  it("reports nothing for a read aborted on close", async () => {
    const { fetchImpl, calls, respond } = deferredFetch();
    const { read, phases } = harness(fetchImpl);

    read.start("https://api.test/v1");
    await tick();
    read.abort();
    expect(calls[0]?.signal.aborted).toBe(true);
    respond(0);
    await tick();
    await tick();

    expect(phases).toEqual([{ phase: "reading" }]);
  });

  it("starts nothing and clears for an invalid or empty URL", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const { read, phases } = harness(fetchImpl);

    read.start("not-a-url");
    await tick();
    read.start("");
    await tick();

    expect(calls).toHaveLength(0);
    expect(phases).toEqual([{ phase: "cleared" }, { phase: "cleared" }]);
  });
});
