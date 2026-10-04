import { describe, expect, it, vi } from "vitest";
import { createDeadClipRegistry } from "./dead-clips";

describe("createDeadClipRegistry — a permanently missing VRMA is warned once and never refetched", () => {
  function makeLog() {
    return { warn: vi.fn() };
  }

  it("starts with no path marked dead", () => {
    const reg = createDeadClipRegistry(makeLog());
    expect(reg.isDead("/purchased_motions/thinking.vrma")).toBe(false);
  });

  it("markDead warns once with the path and the error, then isDead is true", () => {
    const log = makeLog();
    const reg = createDeadClipRegistry(log);

    reg.markDead(
      "/purchased_motions/thinking.vrma",
      new Error("JSON Parse error: Unrecognized token '<'"),
    );

    expect(reg.isDead("/purchased_motions/thinking.vrma")).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("vrma_load_failed", {
      vrma_path: "/purchased_motions/thinking.vrma",
      error: expect.stringContaining("Unrecognized token"),
    });
  });

  it("marking the same path again does not warn again (no per-turn log spam)", () => {
    const log = makeLog();
    const reg = createDeadClipRegistry(log);

    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));
    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("tracks paths independently", () => {
    const reg = createDeadClipRegistry(makeLog());
    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));
    expect(reg.isDead("/motions/calm.vrma")).toBe(false);
  });
});
