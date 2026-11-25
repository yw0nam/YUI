/** The Threads window's keys: Control+Command+S toggles the list, Escape closes, ↑/↓ move through the list; a terminal keeps every key. */

export function attachThreadsKeys(deps: {
  onToggleList(): void;
  onEscape(): void;
  onMove(delta: 1 | -1): void;
}): () => void {
  function onKeydown(e: KeyboardEvent): void {
    const target = e.target as Element | null;
    if (target?.closest?.(".xterm")) return;
    if (e.ctrlKey && e.metaKey && !e.shiftKey && !e.altKey && e.code === "KeyS") {
      e.preventDefault();
      deps.onToggleList();
      return;
    }
    if (e.key === "Escape") {
      deps.onEscape();
      return;
    }
    // A field, a select or a radio group keeps its arrows, and a shortcut is not a move.
    const own = "textarea, select, input, [role=combobox], [role=radiogroup]";
    if (target?.closest?.(own) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      deps.onMove(e.key === "ArrowDown" ? 1 : -1);
    }
  }
  document.addEventListener("keydown", onKeydown);
  return () => document.removeEventListener("keydown", onKeydown);
}
