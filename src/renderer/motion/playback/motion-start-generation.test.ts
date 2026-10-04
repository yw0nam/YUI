import { describe, expect, it } from "vitest";
import { createMotionStartGeneration } from "./motion-start-generation";

describe("createMotionStartGeneration", () => {
  it("marks a deferred motion load stale when a later start supersedes it", async () => {
    let resolveLoad!: () => void;
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    const generation = createMotionStartGeneration();
    const first = (async () => {
      const token = generation.begin();
      await load;
      return generation.isCurrent(token);
    })();

    const secondToken = generation.begin();
    resolveLoad();

    await expect(first).resolves.toBe(false);
    expect(generation.isCurrent(secondToken)).toBe(true);
  });

  it("invalidates an in-flight start during teardown", () => {
    const generation = createMotionStartGeneration();
    const token = generation.begin();

    generation.invalidate();

    expect(generation.isCurrent(token)).toBe(false);
  });
});
