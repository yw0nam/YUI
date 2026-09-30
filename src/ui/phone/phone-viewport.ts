/** The composer's bottom offset inside the phone root, in px. */
export const PHONE_INPUT_BOTTOM_PX = 8;

interface ViewportLike extends Pick<EventTarget, "addEventListener" | "removeEventListener"> {
  readonly height: number;
  readonly offsetTop: number;
}

const PROPERTIES = [
  "--yui-visual-viewport-top",
  "--yui-visual-viewport-height",
  "--yui-keyboard-overlap",
] as const;

/**
 * Sizes the phone root to the visual viewport: writes its top and height, and the keyboard
 * overlap below it, as custom properties on `root`. Returns the detach.
 */
export function attachVisualViewport(deps: {
  root: HTMLElement;
  viewport: ViewportLike | null | undefined;
  layoutHeight: () => number;
}): () => void {
  const { root, viewport, layoutHeight } = deps;
  if (!viewport) return () => {};

  const apply = (): void => {
    const { offsetTop, height } = viewport;
    const overlap = Math.max(0, Math.round(layoutHeight() - offsetTop - height));
    root.style.setProperty("--yui-visual-viewport-top", `${Math.round(offsetTop)}px`);
    root.style.setProperty("--yui-visual-viewport-height", `${Math.round(height)}px`);
    root.style.setProperty("--yui-keyboard-overlap", `${overlap}px`);
  };
  apply();
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    for (const name of PROPERTIES) root.style.removeProperty(name);
  };
}
