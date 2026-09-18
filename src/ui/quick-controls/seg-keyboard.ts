// ── Shared segmented-control keyboard pattern ──
// Arrows/Home/End always navigate (clamped by the domain's own select/move function); an optional
// commit step handles Space/Enter separately for patterns where focus doesn't imply selection
// (see handleLangSegKeydown). getBaseIndex lets each caller define its own "current position" —
// by checked state for combined navigate+select segments, by focus for roving-focus-only segments.
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
