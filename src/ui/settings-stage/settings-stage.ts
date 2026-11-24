/** The settings window's stage: a column on the window's left, beside the panel. */

import "./settings-stage.css";

export function createSettingsStage(deps: { mount: HTMLElement }): { dispose(): void } {
  const el = document.createElement("div");
  el.className = "yui-settings-stage";
  deps.mount.appendChild(el);
  return { dispose: () => el.remove() };
}
