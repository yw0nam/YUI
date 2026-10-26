/**
 * Header buttons — owns the panel header's pop-out, message and close buttons: node
 * queries, handlers, listeners, teardown.
 */

interface HeaderButtonsDeps {
  /** Panel root (el) — query the header buttons here; a button the variant does not render is absent. */
  root: HTMLElement;
  /** Closes the panel. */
  close: () => void;
  onPopOut?: () => void;
  /** Opens the text input. */
  onMessage?: () => void;
}

interface HeaderButtons {
  /** Permanent teardown — remove the pop-out, message and close listeners. */
  dispose(): void;
}

export function createHeaderButtons(deps: HeaderButtonsDeps): HeaderButtons {
  const { root: el, close, onPopOut, onMessage } = deps;

  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const messageBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--message");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");

  function handlePopOut(): void {
    onPopOut?.();
  }

  // Close first: the panel restores focus on close, and the text input must take it after.
  function handleMessage(): void {
    close();
    onMessage?.();
  }

  popOutBtn?.addEventListener("click", handlePopOut);
  messageBtn?.addEventListener("click", handleMessage);
  closeBtn?.addEventListener("click", close);

  return {
    dispose(): void {
      popOutBtn?.removeEventListener("click", handlePopOut);
      messageBtn?.removeEventListener("click", handleMessage);
      closeBtn?.removeEventListener("click", close);
    },
  };
}
