/**
 * Panel shell — the open/close lifecycle of the panel that fills the settings window.
 * Content refresh (reflect/render/monitor) is delegated to the onOpen callback;
 * gain/audition/key-commit cleanup is delegated to the onClose callback.
 */

interface PanelShellDeps {
  /** Mount container the panel attaches to. */
  mount: HTMLElement;
  /** Panel root node (el). */
  root: HTMLElement;
  /** Injected by the host when Escape must close the OS window. Without it, Escape is a no-op. */
  closeWindow?: () => void;
  /** Refresh content on open (reflect/render/monitor load). */
  onOpen: () => void;
  /** Cleanup before the window closes (gain preview, audition, key commit). */
  onClose: () => void;
}

interface PanelShell {
  open(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createPanelShell(deps: PanelShellDeps): PanelShell {
  const { mount, root, closeWindow, onOpen, onClose } = deps;

  let openState = false;

  // No ring on open — the first control, the character header's first button, stays unlit until
  // the user tabs.
  function focusFirst(): void {
    root.querySelector<HTMLElement>("button, input, select")?.focus({ focusVisible: false });
  }

  function open(): void {
    if (openState) return;
    openState = true;
    mount.appendChild(root);
    onOpen();
    focusFirst();
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

  return { open, isOpen, dispose };
}
