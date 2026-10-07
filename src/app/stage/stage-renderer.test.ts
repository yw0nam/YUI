import { describe, expect, it, vi } from "vitest";

const order: string[] = [];
const { renderer, ambient, cameraDispose } = vi.hoisted(() => ({
  renderer: { dispose: vi.fn() },
  ambient: { start: vi.fn(), stop: vi.fn() },
  cameraDispose: vi.fn(),
}));

vi.mock("../../renderer", () => ({ createRenderer: () => renderer }));
vi.mock("../../ambient/liveliness/tier1", () => ({ createTier1Engine: () => ambient }));
vi.mock("./wire-pet-stage", () => ({
  wireCamera: () => ({ dispose: cameraDispose, apply: vi.fn() }),
}));

import { createStageRenderer } from "./stage-renderer";

describe("createStageRenderer", () => {
  it("registers the renderer dispose before the ambient stop, so a LIFO drain stops ambient first", () => {
    order.length = 0;
    renderer.dispose.mockImplementation(() => order.push("renderer"));
    ambient.stop.mockImplementation(() => order.push("ambient"));
    const disposers: Array<() => void> = [];

    const result = createStageRenderer({
      stage: {} as HTMLElement,
      settings: {} as never,
      register: (dispose) => {
        order.push("registered");
        disposers.push(dispose);
      },
    });
    for (const dispose of disposers.reverse()) dispose();

    expect(result.renderer).toBe(renderer);
    expect(ambient.start).toHaveBeenCalledOnce();
    expect(ambient.stop).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(order).toEqual(["registered", "registered", "registered", "ambient", "renderer"]);
  });
});
