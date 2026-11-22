/** Arrow, Home, End and Space/Enter for a segmented control, navigating from the caller's current index. */
export interface SegKeydownConfig {
  length: number;
  getBaseIndex: () => number;
  onNavigate: (index: number, focus: boolean) => void;
  onCommit?: (index: number) => void;
}

export function handleSegmentKeydown(
  e: KeyboardEvent,
  buttons: HTMLButtonElement[],
  cfg: SegKeydownConfig,
): void {
  const base = cfg.getBaseIndex();
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    cfg.onNavigate(base + 1, true);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    cfg.onNavigate(base - 1, true);
  } else if (e.key === "Home") {
    e.preventDefault();
    cfg.onNavigate(0, true);
  } else if (e.key === "End") {
    e.preventDefault();
    cfg.onNavigate(cfg.length - 1, true);
  } else if (cfg.onCommit && (e.key === " " || e.key === "Enter")) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    const idx = btn ? buttons.indexOf(btn) : -1;
    if (idx < 0) return;
    e.preventDefault();
    cfg.onCommit(idx);
  }
}
