// @vitest-environment jsdom
/** resize-handles.test.ts — the panel's edge and corner hit areas report a resize in screen px, and a lost pointer ends it. */

import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { attachResizeHandles } from "./resize-handles";

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

it.each([
  "pointerup",
  "pointercancel",
  "lostpointercapture",
])("reports a west resize in screen px until %s, with the readout shown meanwhile", (endEvent) => {
  const panel = document.createElement("section");
  document.body.append(panel);
  const events: unknown[] = [];
  attachResizeHandles({
    panel,
    listener: {
      start: () => events.push("start"),
      move: (edge, dx, dy) => events.push([edge, dx, dy]),
      end: () => events.push("end"),
    },
  });
  expect(panel.querySelectorAll("[data-edge]").length).toBe(8);
  const handle = panel.querySelector<HTMLElement>('[data-edge="w"]')!;
  const readout = () => panel.querySelector<HTMLElement>(".yui-threads-readout")!;

  handle.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, pointerId: 1, screenX: 100, screenY: 100 }),
  );
  // The window moves under the pointer on a west resize, so only screen px stay put.
  handle.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 1, screenX: 70, screenY: 105, clientX: 4 }),
  );
  expect(readout().hidden).toBe(false);
  handle.dispatchEvent(new PointerEvent(endEvent, { pointerId: 1 }));
  handle.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

  expect(events).toEqual(["start", ["w", -30, 5], "end"]);
  expect(readout().hidden).toBe(true);
});
