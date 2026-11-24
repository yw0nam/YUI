/**
 * The settings window's stage: a column on the window's left, beside the panel. Its foot names the
 * window's own character (the bound one, else main), not the one the panel edits.
 */

import "./settings-stage.css";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { StageFoot, type StageFootProps } from "./stage-foot";

export function createSettingsStage(deps: StageFootProps & { mount: HTMLElement }): {
  /** The stage column, whose top slot her window docks into. */
  el: HTMLElement;
  dispose(): void;
} {
  const { mount, ...foot } = deps;
  const el = document.createElement("div");
  el.className = "yui-settings-stage";
  mount.appendChild(el);
  const root = createRoot(el);
  // Rendered at once, so the foot's subscriptions are in place before a change can land.
  flushSync(() => root.render(createElement(StageFoot, foot)));
  return {
    el,
    dispose() {
      root.unmount();
      el.remove();
    },
  };
}
