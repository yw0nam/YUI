// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import type { MotionRegistry } from "../../../contract";
import { createLiveStatus } from "./live-status";
import { createMotionPreviewView } from "./view";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders a markup-bearing variant filename in the idle sub-line as text", () => {
  const markupPath = "/motions/<img src=x onerror=alert(1)>.vrma";
  const registry = {
    idle: {
      vrma_path: markupPath,
      variants: [markupPath, "/motions/idle_02.vrma"],
      kind: "ambient",
      loop: true,
      priority: 10,
      interrupt_policy: "replace",
    },
  } satisfies MotionRegistry;
  const view = createMotionPreviewView(document.createElement("div"));
  const subLine = document.createElement("div");
  subLine.id = "idle-sub-line";
  view.mount.appendChild(subLine);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));

  createLiveStatus(view, { id: null }).start(
    () => ({ id: "idle", vrma_path: markupPath }),
    registry,
  );
  frames[0]?.(0);

  expect(subLine.querySelector("img")).toBeNull();
  expect(subLine.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(subLine.querySelector("span")?.textContent).toBe("1/2");
});
