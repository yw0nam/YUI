/**
 * Panel shell — the open/close lifecycle of the panel that fills the settings window.
 * Content refresh (reflect/render/monitor) is delegated to the onOpen callback;
 * gain/audition/key-commit cleanup is delegated to the onClose callback.
 */

interface PopoverDeps {
  /** Mount container the panel attaches to. */
  mount: HTMLElement;
  /** Panel root node (el). */
  root: HTMLElement;
  /** Injected by the host when Escape must close the OS window. Without it, Escape is a no-op. */
  closeWindow?: () => void;
  /** Refresh content on open (reflect/render/monitor load). */
  onOpen: () => void;
  /** Cleanup on close (gain preview, audition, key commit). Called before openState=false. */
  onClose: () => void;
}

interface Popover {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createPopover(deps: PopoverDeps): Popover {
  const { mount, root, closeWindow, onOpen, onClose } = deps;

  let openState = false;

  const FOCUSABLE_SEL =
    'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

  // True for content a collapsed <details> (the filler's more-phrases group) hides —
  // its own <summary> stays reachable (that's how the user reopens it via keyboard), everything
  // else inside its collapsed body does not.
  function isInsideClosedDetails(el: HTMLElement): boolean {
    const closedDetails = el.closest("details:not([open])");
    if (!closedDetails) return false;
    return !(el.tagName === "SUMMARY" && el.parentElement === closedDetails);
  }

  // No ring on open — the first control stays unlit until the user tabs. Controls in [hidden]
  // subtrees (inactive tab panels) and roving-tabindex members Tab skips are passed over.
  function focusFirst(): void {
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL))
      .find(
        (el) =>
          !(el as HTMLButtonElement).disabled &&
          el.tabIndex >= 0 &&
          !el.closest("[hidden]") &&
          !isInsideClosedDetails(el),
      )
      ?.focus({ focusVisible: false });
  }

  function open(): void {
    if (openState) return;
    openState = true;
    mount.appendChild(root);
    onOpen();
    focusFirst();
  }

  // The panel stays in its window; closing the window is the host's job.
  function close(): void {
    if (!openState) return;
    onClose();
    openState = false;
  }

  function isOpen(): boolean {
    return openState;
  }

  function handleDocKeydown(e: KeyboardEvent): void {
    if (!openState || e.key !== "Escape" || !closeWindow) return;
    // A modal dialog over the panel owns its keys.
    if ((e.target as Element | null)?.closest?.("dialog[open]")) return;
    e.preventDefault();
    onClose(); // Run cleanup (key commit, audition abort) first.
    closeWindow();
  }

  document.addEventListener("keydown", handleDocKeydown);

  function dispose(): void {
    document.removeEventListener("keydown", handleDocKeydown);
  }

  return { open, close, isOpen, dispose };
}
