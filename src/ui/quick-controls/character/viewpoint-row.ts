/** View-reset row — the button that returns the camera to its default view. */

import type { Logger } from "../../../logger";

/** Bind the reset button under `root`; returns the unbind. */
export function bindViewpointReset(deps: {
  root: HTMLElement;
  onReset: () => void;
  log: Logger;
}): () => void {
  const { root, onReset, log } = deps;
  const button = root.querySelector<HTMLButtonElement>(".yui-viewpoint-reset")!;
  const handleClick = (): void => {
    onReset();
    log.info("viewpoint_reset");
  };
  button.addEventListener("click", handleClick);
  return () => button.removeEventListener("click", handleClick);
}
