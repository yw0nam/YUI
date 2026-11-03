/**
 * The Connection page's two views: Quick start and Detailed settings. The switch above them
 * picks which one shows; the choice lives for the window.
 */

import { t } from "../../i18n";
import { handleSegmentKeydown } from "../seg-keyboard";
import "./connection-views.css";

export type ConnectionView = "quick" | "detail";

const VIEWS: readonly ConnectionView[] = ["quick", "detail"];
const VIEW_LABEL_KEYS: Record<ConnectionView, string> = {
  quick: "start.view_quick",
  detail: "start.view_detail",
};

export function createConnectionViews(deps: {
  /** The Connection page's panel. */
  panel: HTMLElement;
  /** The Quick start view's element. */
  quick: HTMLElement;
  /** The Detailed settings view's element. */
  detail: HTMLElement;
  initial: ConnectionView;
  /** Quick start came into view — it re-reads its state from the stores. */
  onQuickShown: () => void;
  /** Detailed settings is in view on entry or came into view — the chat section evaluates its model list read. */
  onDetailEntered: () => void;
}): {
  /** The Connection page was entered (panel open on it, or its rail item selected). */
  entered(): void;
  dispose(): void;
} {
  const { panel, quick, detail, initial, onQuickShown, onDetailEntered } = deps;

  const seg = document.createElement("div");
  seg.className = "yui-seg yui-conn-views";
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", t("start.views_aria"));
  const cells = VIEWS.map((view) => {
    const cell = document.createElement("button");
    cell.className = "yui-seg__btn";
    cell.type = "button";
    cell.setAttribute("role", "radio");
    cell.dataset.view = view;
    cell.textContent = t(VIEW_LABEL_KEYS[view]);
    seg.append(cell);
    return cell;
  });

  const quickView = document.createElement("div");
  quickView.className = "yui-conn-view";
  quickView.dataset.view = "quick";
  quickView.append(quick);

  const detailView = document.createElement("div");
  detailView.className = "yui-conn-view";
  detailView.dataset.view = "detail";
  const note = document.createElement("p");
  note.className = "yui-sec__note";
  note.textContent = t("start.detail_note");
  detailView.append(note, detail);

  const scope = panel.querySelector<HTMLElement>(".yui-tabpanel__scope");
  panel.querySelector<HTMLElement>(".yui-tabpanel__title")!.after(seg, quickView, detailView);

  let current: ConnectionView = initial;

  function reflect(): void {
    for (const [index, view] of VIEWS.entries()) {
      const on = view === current;
      cells[index]!.setAttribute("aria-checked", String(on));
      cells[index]!.tabIndex = on ? 0 : -1;
    }
    quickView.hidden = current !== "quick";
    detailView.hidden = current !== "detail";
    if (scope) scope.hidden = current === "quick";
  }

  function select(view: ConnectionView): void {
    if (current === view) return;
    current = view;
    reflect();
    if (view === "quick") onQuickShown();
    else onDetailEntered();
  }

  function handleClick(e: MouseEvent): void {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!cell) return;
    select(cell.dataset.view as ConnectionView);
  }

  function handleKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, cells, {
      length: cells.length,
      getBaseIndex: () => VIEWS.indexOf(current),
      onNavigate: (index, focus) => {
        const view = VIEWS[clamp(index)]!;
        select(view);
        if (focus) cells[VIEWS.indexOf(view)]!.focus();
      },
      onCommit: (index) => select(VIEWS[clamp(index)]!),
    });
  }

  function clamp(index: number): number {
    return Math.min(cells.length - 1, Math.max(0, index));
  }

  seg.addEventListener("click", handleClick);
  seg.addEventListener("keydown", handleKeydown);
  reflect();

  return {
    entered: () => {
      if (current === "detail") onDetailEntered();
    },
    dispose(): void {
      seg.removeEventListener("click", handleClick);
      seg.removeEventListener("keydown", handleKeydown);
    },
  };
}
