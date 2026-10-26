/** Developer Tools row of the General tab: one button that opens the DevTools window. */

/** Calls `open` when the row's button is clicked. Returns the detach. */
export function bindDevtoolsRow(root: HTMLElement, open: () => void): () => void {
  const button = root.querySelector<HTMLButtonElement>(".yui-devtools-open");
  button?.addEventListener("click", open);
  return () => button?.removeEventListener("click", open);
}
