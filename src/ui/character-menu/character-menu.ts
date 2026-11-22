/** The Character menu: two pill columns beside her in the pet window, their lists swapped in place. */

import "./character-menu.css";
import type { BasePace } from "../../settings/active-hours/base-pace-settings";
import { t } from "../i18n";
import { CHECK_SVG } from "../threads/glyphs";
import { CHEVRON, GLYPHS } from "./glyphs";
import {
  type ListId,
  listItems,
  type MenuItem,
  type MenuKind,
  type MenuState,
  topItems,
} from "./items";
import { menuKey } from "./keys";
import { columnLeft, type Fold, gridWidth, type MenuWidths } from "./layout";

/** Where the menu draws, in the mount's px. */
export interface MenuPlacement {
  fold: Fold;
  /** The columns' top: her shoulder line. */
  top: number;
  /** Where the pills pop out from. */
  chest: { x: number; y: number };
  /** Her head's top: her name sits above it. */
  head: number;
}

export interface MenuActions {
  talk(open: boolean): void;
  rest(on: boolean): void;
  listen(on: boolean): void;
  settings(page?: "body" | "voice"): void;
  body(id: string): void;
  voice(id: string): void;
  pace(pace: BasePace): void;
  threads(tab: "threads" | "terminal"): void;
  bubble(on: boolean): void;
  unified(on: boolean): void;
  reset(): void;
  turnOff(): void;
}

/** A pill row's pitch: 36px tall plus the 8px gap; the stylesheet sets the same. */
const ROW_PX = 44;
/** Each pill pops out this long after the one before it, in keyboard order. */
const STAGGER_MS = 30;
const LISTS: readonly ListId[] = ["body", "voice", "pace", "more"];

type ColumnKey = "right" | "left" | "all" | ListId;
type Side = "left" | "right";

export function createCharacterMenu(deps: {
  mount: HTMLElement;
  kind: MenuKind;
  name(): string;
  read(): MenuState;
  /** Widens the window for the measured columns and says where the menu draws. */
  place(widths: MenuWidths): Promise<MenuPlacement>;
  /** Puts the window back once the menu has left the screen. */
  restore(): Promise<void>;
  actions: MenuActions;
  onBlur(cb: () => void): () => void;
}): { open(): Promise<void>; close(): Promise<void>; dispose(): void; isOpen(): boolean } {
  const { mount, kind, actions } = deps;
  const root = document.createElement("div");
  root.className = "yui-cmenu";
  root.setAttribute("role", "menu");
  root.hidden = true;
  mount.appendChild(root);

  let phase: "closed" | "opening" | "open" | "closing" = "closed";
  let pending: Promise<void> = Promise.resolve();
  let list: ListId | null = null;
  let confirm: string | null = null;
  let placement: MenuPlacement | null = null;
  let widths: Record<ColumnKey, number> | null = null;

  function pill(item: MenuItem, measuring = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "yui-cmenu__pill";
    b.dataset.id = item.id;
    b.classList.toggle("is-on", item.role === "toggle" && item.on === true);
    b.classList.toggle("is-back", item.role === "back");
    b.classList.toggle("is-danger", item.role === "danger");
    if (item.role === "toggle" || item.role === "choice") {
      b.setAttribute("role", item.role === "toggle" ? "menuitemcheckbox" : "menuitemradio");
      b.setAttribute("aria-checked", String(item.on === true));
    } else b.setAttribute("role", "menuitem");
    if (item.role === "list") b.setAttribute("aria-haspopup", "menu");
    if (item.aria) b.setAttribute("aria-label", item.aria);
    b.innerHTML = GLYPHS[item.glyph] ?? "";
    const label = document.createElement("span");
    label.className = "yui-cmenu__label";
    label.textContent = item.label;
    b.appendChild(label);
    if (item.role === "list") b.insertAdjacentHTML("beforeend", CHEVRON);
    if (item.role === "choice" && (item.on || measuring))
      b.insertAdjacentHTML("beforeend", CHECK_SVG);
    if (item.badge !== undefined) {
      const badge = document.createElement("span");
      badge.className = "yui-cmenu__badge";
      badge.textContent = String(item.badge);
      b.appendChild(badge);
    }
    // Talk's ON state is the open input itself; every other ON toggle names it in text.
    if (item.role === "toggle" && item.id !== "talk" && (item.on || measuring)) {
      const on = document.createElement("span");
      on.className = "yui-cmenu__on";
      on.textContent = t("character_menu.on");
      b.appendChild(on);
    }
    return b;
  }

  function confirmRow(item: MenuItem): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-cmenu__confirm";
    row.dataset.id = item.id;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", item.label);
    const sure = document.createElement("button");
    sure.type = "button";
    sure.className = "yui-cmenu__pill yui-cmenu__sure";
    sure.dataset.act = "sure";
    sure.textContent = t("character_menu.sure");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "yui-cmenu__pill yui-cmenu__cancel";
    cancel.dataset.act = "cancel";
    cancel.textContent = t("character_menu.cancel");
    row.append(sure, cancel);
    return row;
  }

  function columnItems(state: MenuState): Record<ColumnKey, MenuItem[]> {
    const top = topItems(kind, state);
    return {
      right: top.right,
      left: top.left,
      all: [...top.right, ...top.left],
      body: listItems("body", kind, state),
      voice: listItems("voice", kind, state),
      pace: listItems("pace", kind, state),
      more: listItems("more", kind, state),
    };
  }

  /** The widest row of every column state, with every check and On text shown, More with its confirm row. */
  function measure(): Record<ColumnKey, number> {
    const items = columnItems(deps.read());
    const box = document.createElement("div");
    box.className = "yui-cmenu__measure";
    mount.appendChild(box);
    const out = {} as Record<ColumnKey, number>;
    for (const key of Object.keys(items) as ColumnKey[]) {
      const danger = items[key].find((i) => i.role === "danger");
      box.replaceChildren(
        ...items[key].map((i) => pill(i, true)),
        ...(danger ? [confirmRow(danger)] : []),
      );
      out[key] = box.getBoundingClientRect().width;
    }
    box.remove();
    return out;
  }

  /** The columns as drawn, in keyboard order: the right one first, so Talk leads. */
  function columns(): { side: Side; key: ColumnKey }[] {
    const fold = placement?.fold ?? "none";
    if (fold !== "none") return [{ side: fold, key: list ?? "all" }];
    return [
      { side: "right", key: "right" },
      { side: "left", key: list ?? "left" },
    ];
  }

  function render(pop = false): void {
    if (!placement || !widths) return;
    const items = columnItems(deps.read());
    const centre = mount.clientWidth / 2;
    root.replaceChildren();
    const name = document.createElement("p");
    name.className = "yui-cmenu__name";
    name.textContent = deps.name();
    name.style.setProperty("top", `${placement.head}px`);
    root.appendChild(name);
    root.classList.toggle("is-pop", pop);
    let order = 0;
    for (const { side, key } of columns()) {
      const width = gridWidth(widths[key]);
      const left = columnLeft(side, centre, width);
      const col = document.createElement("div");
      col.className = `yui-cmenu__col yui-cmenu__col--${side}`;
      col.setAttribute("role", "group");
      if (LISTS.includes(key as ListId)) col.dataset.list = key;
      col.style.setProperty("left", `${left}px`);
      col.style.setProperty("top", `${placement.top}px`);
      if (width > 0) col.style.setProperty("width", `${width}px`);
      items[key].forEach((item, i) => {
        const row = confirm === item.id ? confirmRow(item) : pill(item);
        row.style.setProperty("--yui-cmenu-fx", `${placement!.chest.x - (left + width / 2)}px`);
        row.style.setProperty(
          "--yui-cmenu-fy",
          `${placement!.chest.y - (placement!.top + i * ROW_PX + ROW_PX / 2)}px`,
        );
        row.style.setProperty("--yui-cmenu-delay", `${order++ * STAGGER_MS}ms`);
        col.appendChild(row);
      });
      root.appendChild(col);
    }
  }

  /** The columns left to right, as the keyboard moves between them. */
  const columnsByX = (): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>(".yui-cmenu__col")].sort(
      (a, b) => Number.parseFloat(a.style.left) - Number.parseFloat(b.style.left),
    );

  function focusRow(row: Element | null | undefined): void {
    const target = row?.classList.contains("yui-cmenu__confirm")
      ? row.querySelector(".yui-cmenu__cancel")
      : row;
    (target as HTMLElement | null | undefined)?.focus({ preventScroll: true });
  }

  const focusId = (id: string): void => focusRow(root.querySelector(`[data-id="${id}"]`));

  function show(next: ListId | null, focus: string): void {
    list = next;
    confirm = null;
    render();
    focusId(focus);
  }

  function back(): void {
    const parent = list;
    if (parent) show(null, parent);
  }

  /** Closes, then runs `after` once the window is restored. */
  function closeThen(after: () => void): void {
    void close().then(after);
  }

  /** The picks that close the menu, each run once the window is restored. */
  const closing: Partial<Record<string, () => void>> = {
    settings: () => actions.settings(),
    "body-more": () => actions.settings("body"),
    "voice-more": () => actions.settings("voice"),
    threads: () => actions.threads("threads"),
    terminal: () => actions.threads("terminal"),
  };

  function pick(id: string): void {
    const state = deps.read();
    const [chosen, value] = id.split(":") as [string, string | undefined];
    const after = closing[id] ?? (id === "talk" && !state.talk ? () => actions.talk(true) : null);
    if (after) closeThen(after);
    else if (id === "back") back();
    else if ((LISTS as readonly string[]).includes(id)) {
      const items = listItems(id as ListId, kind, state);
      show(id as ListId, (items.find((i) => i.on) ?? items[1] ?? items[0]!).id);
    } else if (value !== undefined) {
      if (chosen === "body") actions.body(value);
      if (chosen === "voice") actions.voice(value);
      if (chosen === "pace") actions.pace(value as BasePace);
      show(null, chosen);
    } else {
      if (id === "talk") actions.talk(false);
      if (id === "rest" || id === "listen" || id === "bubble" || id === "unified")
        actions[id](!state[id]);
      if (id === "reset" || id === "turn-off") confirm = id;
      render();
      focusId(id);
    }
  }

  function answer(sure: boolean): void {
    const was = confirm;
    if (!was) return;
    confirm = null;
    if (sure && was === "turn-off") {
      closeThen(actions.turnOff);
      return;
    }
    if (sure) actions.reset();
    render();
    focusId(was);
  }

  function onClick(e: MouseEvent): void {
    const button = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.act) {
      answer(button.dataset.act === "sure");
      return;
    }
    if (button.dataset.id) pick(button.dataset.id);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (phase !== "open") return;
    const active = document.activeElement;
    const rowEl = active?.closest(".yui-cmenu__col > *") ?? null;
    const cols = columnsByX();
    const colEl = rowEl?.parentElement ?? null;
    const column = colEl ? cols.indexOf(colEl) : -1;
    // Away from the pills, only Esc reaches the menu.
    if (column < 0 && e.key !== "Escape") return;
    const listCol = cols.findIndex((c) => c.dataset.list);
    const move = menuKey(e.key, e.shiftKey, {
      rows: cols.map((c) => c.children.length),
      column,
      row: colEl && rowEl ? [...colEl.children].indexOf(rowEl) : -1,
      listColumn: listCol < 0 ? null : listCol,
      confirming: confirm !== null,
      inConfirm: rowEl?.classList.contains("yui-cmenu__confirm") ?? false,
    });
    if (!move) return;
    e.preventDefault();
    switch (move.kind) {
      case "focus":
        focusRow(cols[move.column]?.children[move.row]);
        return;
      case "cancel": {
        const was = confirm!;
        confirm = null;
        render();
        if (!move.to) {
          focusId(was);
          return;
        }
        focusRow(columnsByX()[move.to.column]?.children[move.to.row]);
        return;
      }
      case "swap":
        focusRow(
          rowEl?.querySelector(
            active?.classList.contains("yui-cmenu__cancel")
              ? ".yui-cmenu__sure"
              : ".yui-cmenu__cancel",
          ),
        );
        return;
      case "tab": {
        const all = [...root.querySelectorAll<HTMLButtonElement>("button")];
        const at = all.indexOf(active as HTMLButtonElement);
        all[(at + move.by + all.length) % all.length]?.focus({ preventScroll: true });
        return;
      }
      case "back":
        back();
        return;
      case "close":
        void close();
    }
  }

  const inMenu = (target: EventTarget | null): boolean =>
    target instanceof Node && root.contains(target);

  // A right-click closes through contextmenu instead, so the press that closes the menu never reopens it.
  function onPointerDown(e: PointerEvent): void {
    if (phase === "open" && e.button !== 2 && !inMenu(e.target)) void close();
  }

  function onContextMenu(e: MouseEvent): void {
    if (phase !== "open") return;
    e.preventDefault();
    if (inMenu(e.target)) return;
    e.stopPropagation();
    void close();
  }

  async function open(): Promise<void> {
    if (phase !== "closed") return;
    phase = "opening";
    list = null;
    confirm = null;
    const measured = measure();
    pending = (async () => {
      let placed: MenuPlacement;
      try {
        placed = await deps.place({
          right: measured.right,
          left: measured.left,
          all: measured.all,
          lists: LISTS.map((key) => measured[key]),
        });
      } catch (err) {
        phase = "closed";
        throw err;
      }
      // Closed while the window widened: put it back at once.
      if (phase !== "opening") {
        await deps.restore().finally(() => {
          phase = "closed";
        });
        return;
      }
      placement = placed;
      widths = measured;
      phase = "open";
      root.setAttribute("aria-label", t("character_menu.label", { name: deps.name() }));
      root.hidden = false;
      render(true);
      focusId("talk");
    })();
    await pending;
  }

  async function close(): Promise<void> {
    if (phase === "opening") phase = "closing";
    if (phase !== "open") return pending;
    phase = "closing";
    root.hidden = true;
    root.replaceChildren();
    pending = deps.restore().finally(() => {
      phase = "closed";
    });
    return pending;
  }

  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  const offBlur = deps.onBlur(() => void close());

  return {
    open,
    close,
    isOpen: () => phase === "open",
    dispose() {
      offBlur();
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      root.remove();
    },
  };
}
