/** The Threads window's keys: Control+Command+S toggles the list, Escape closes, 1–9 pick a choice, ↑/↓ move through the list. */

export function attachThreadsKeys(deps: {
  onToggleList(): void;
  onEscape(): void;
  onPick(index: number): void;
  onMove(delta: 1 | -1): void;
}): () => void {
  function onKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey && e.metaKey && !e.shiftKey && !e.altKey && e.code === "KeyS") {
      e.preventDefault();
      deps.onToggleList();
      return;
    }
    if (e.key === "Escape") {
      deps.onEscape();
      return;
    }
    // Typing in the field or the select keeps its keys, and a shortcut is not a choice.
    const target = e.target as Element | null;
    if (target?.closest?.("textarea, select, input") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      deps.onPick(Number(e.key) - 1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      deps.onMove(e.key === "ArrowDown" ? 1 : -1);
    }
  }
  document.addEventListener("keydown", onKeydown);
  return () => document.removeEventListener("keydown", onKeydown);
}
