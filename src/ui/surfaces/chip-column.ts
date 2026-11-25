/**
 * Chip column — while an Ask card or the speech bubble shows, moves the column up so it ends 8px above
 * that surface, and folds the non-urgent rows that still do not fit into one "+N" row. The rows are the
 * column's `[data-chip-count]` elements, set by the chips; urgent ones carry `data-chip-urgent`.
 */

import { t } from "../i18n";

/** The room kept above the surface under the column, and under the window's top edge. */
const CLEARANCE_PX = 8;

export interface ColumnRow {
  top: number;
  bottom: number;
  urgent: boolean;
  count: number;
}

export interface ColumnPlan {
  /** How far the column moves up, in px. */
  shift: number;
  /** The indexes of the rows that hide. */
  hide: number[];
  /** The summed count of the hidden rows, shown by the "+N" row; 0 shows none. */
  folded: number;
}

/** Plans the column against `limit`, the lowest its last row may end; all values share one coordinate space. */
export function planColumn({
  rows,
  top,
  limit,
  edge,
  gap,
  foldRowHeight,
}: {
  rows: ColumnRow[];
  /** The column's top at its own place. */
  top: number;
  limit: number;
  /** The highest the column's top may move to. */
  edge: number;
  gap: number;
  foldRowHeight: number;
}): ColumnPlan {
  const bottom = rows.at(-1)?.bottom ?? top;
  if (bottom <= limit) return { shift: 0, hide: [], folded: 0 };
  const shift = Math.max(0, Math.min(bottom - limit, top - edge));
  if (bottom - shift <= limit) return { shift, hide: [], folded: 0 };

  const start = top - shift;
  const height = (row: ColumnRow): number => row.bottom - row.top;
  const others = rows.flatMap((row, index) => (row.urgent ? [] : [index]));
  // Every kept row adds its height and the gap after it; the fold row comes last.
  let used = rows.reduce((sum, row) => (row.urgent ? sum + height(row) + gap : sum), 0);
  // Only urgent rows may pass the limit: with no room for the fold row, every other row hides unnamed.
  if (start + used + foldRowHeight > limit) return { shift, hide: others, folded: 0 };
  let kept = 0;
  for (const index of others) {
    const next = used + height(rows[index]!) + gap;
    if (start + next + foldRowHeight > limit) break;
    used = next;
    kept++;
  }
  const hide = others.slice(kept);
  return { shift, hide, folded: hide.reduce((sum, index) => sum + rows[index]!.count, 0) };
}

/** The used `top` of a positioned element, which its transform leaves out. */
const usedTop = (el: Element): number => Number.parseFloat(getComputedStyle(el).top);

/** `el`'s box in the viewport, less the vertical move of its own transform, such as an entrance. */
function settledBox(el: Element): { top: number; bottom: number } {
  const { transform } = getComputedStyle(el);
  const moved = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
  const { top, bottom } = el.getBoundingClientRect();
  return { top: top - moved, bottom: bottom - moved };
}

/** Keeps the pet window's chip column clear of the Ask card and the bubble; returns its dispose. */
export function attachChipColumn({
  root,
  column,
  bubble,
  askSlot,
}: {
  root: HTMLElement;
  column: HTMLElement;
  bubble: HTMLElement;
  askSlot: HTMLElement;
}): () => void {
  const fold = document.createElement("div");
  fold.className = "yui-sigchip__more yui-chip-column__fold";
  let frame = 0;

  function obstacleTop(): number | null {
    const card = askSlot.querySelector<HTMLElement>(".yui-ask-card:not([hidden])");
    if (card) return settledBox(card).top - root.getBoundingClientRect().top;
    const shown =
      !bubble.hidden &&
      bubble.classList.contains("is-visible") &&
      getComputedStyle(bubble).visibility !== "hidden";
    return shown ? usedTop(bubble) : null;
  }

  function uncap(): void {
    for (const row of column.querySelectorAll(".is-capped")) row.classList.remove("is-capped");
    fold.remove();
  }

  function apply(): void {
    frame = 0;
    uncap();
    const obstacle = obstacleTop();
    let shift = 0;
    if (obstacle !== null) {
      const rows = [...column.querySelectorAll<HTMLElement>("[data-chip-count]")].filter(
        (row) => row.getBoundingClientRect().height > 0,
      );
      column.append(fold);
      // Rows are read against the column's own box, which moves with them.
      const top = usedTop(column);
      const offset = top - column.getBoundingClientRect().top;
      const plan = planColumn({
        rows: rows.map((row) => {
          const box = settledBox(row);
          return {
            top: box.top + offset,
            bottom: box.bottom + offset,
            urgent: row.hasAttribute("data-chip-urgent"),
            count: Number(row.dataset.chipCount),
          };
        }),
        top,
        limit: obstacle - CLEARANCE_PX,
        edge: CLEARANCE_PX,
        gap: Number.parseFloat(getComputedStyle(column).rowGap) || 0,
        foldRowHeight: fold.getBoundingClientRect().height,
      });
      shift = plan.shift;
      for (const index of plan.hide) rows[index]!.classList.add("is-capped");
      if (plan.folded > 0) {
        fold.textContent = t("sigchip.more", { n: plan.folded });
        fold.title = t("chips.folded_hint", { n: plan.folded });
      } else {
        fold.remove();
      }
    }
    column.style.transform = shift > 0 ? `translateY(${-shift}px)` : "";
    // The changes this frame made are no news to it.
    mutations.takeRecords();
  }

  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(apply);
  }

  const mutations = new MutationObserver(schedule);
  mutations.observe(column, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "class", "data-chip-count"],
  });
  const surfaceAttributes = ["hidden", "class", "style"];
  mutations.observe(bubble, { attributes: true, attributeFilter: surfaceAttributes });
  mutations.observe(askSlot, {
    subtree: true,
    attributes: true,
    attributeFilter: surfaceAttributes,
  });
  const resizes = new ResizeObserver(schedule);
  for (const el of [root, column, bubble, ...askSlot.children]) resizes.observe(el);
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    mutations.disconnect();
    resizes.disconnect();
    uncap();
    column.style.transform = "";
  };
}
