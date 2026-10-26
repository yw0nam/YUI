/** Cmd+W (Ctrl+W off macOS) runs the × path: the frameless window gets no native File → Close Window. */
export function installCloseShortcut(onClose: () => void): () => void {
  const mac = navigator.platform.startsWith("Mac");
  const onKeyDown = (e: KeyboardEvent): void => {
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== "w") return;
    e.preventDefault();
    onClose();
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}
