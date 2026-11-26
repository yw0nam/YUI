/**
 * The settings window's stage: a column on the window's left, beside the panel. Its foot names the
 * window's own character (the bound one, else main), not the one the panel edits. Its top slot is
 * the largest 2:3 box that leaves the foot 80px and the panel 480px, from 373 × 560 to 600 × 900.
 */

import "./settings-stage.css";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { StageFoot, type StageFootProps } from "./stage-foot";

/** The slot's whole-px size in a page `innerWidth` × `innerHeight`. */
function slotSize(innerWidth: number, innerHeight: number): { width: number; height: number } {
  const fits = Math.min(innerHeight - 80, (innerWidth - 480) * 1.5);
  const height = Math.round(Math.min(900, Math.max(560, fits)));
  return { width: Math.round((height * 2) / 3), height };
}

export function createSettingsStage(deps: StageFootProps & { mount: HTMLElement }): {
  /** The stage column, whose top slot her window docks into. */
  el: HTMLElement;
  dispose(): void;
} {
  const { mount, ...foot } = deps;
  const el = document.createElement("div");
  el.className = "yui-settings-stage";
  const sizeSlot = (): void => {
    const { width, height } = slotSize(window.innerWidth, window.innerHeight);
    el.style.setProperty("--yui-stage-slot-w", `${width}px`);
    el.style.setProperty("--yui-stage-slot-h", `${height}px`);
  };
  sizeSlot();
  window.addEventListener("resize", sizeSlot);
  mount.appendChild(el);
  const root = createRoot(el);
  // Rendered at once, so the foot's subscriptions are in place before a change can land.
  flushSync(() => root.render(createElement(StageFoot, foot)));
  return {
    el,
    dispose() {
      window.removeEventListener("resize", sizeSlot);
      root.unmount();
      el.remove();
    },
  };
}
