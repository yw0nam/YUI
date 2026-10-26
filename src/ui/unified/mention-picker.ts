/**
 * The @ list over the unified chat window's field — a combobox listbox after the model combobox:
 * it opens on an `@` fragment before the caret, filters the open presets by name and offers
 * @everyone. Enter and Tab pick the highlighted option; a pick removes the fragment and reports
 * the choice.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { avatarEl } from "./avatar";
import { EVERYONE, type Mention } from "./targets";

const LIST_ID = "yui-uc-mention-list";
/** Matches the `@fragment` that ends the text before the caret. */
const FRAGMENT = /(^|\s)@([^\s@]*)$/;

/** Plain Tab picks the highlighted option; Shift+Tab and modified Tabs keep their other jobs. */
const isTabPick = (e: KeyboardEvent): boolean =>
  e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

export interface MentionPicker {
  /** Rebuilds the open list from the current cast, keeping the highlight; a closed list stays closed. */
  refresh(): void;
  dispose(): void;
}

export function createMentionPicker(deps: {
  field: HTMLTextAreaElement;
  /** Where the list sits; a positioned ancestor of the field. */
  mount: HTMLElement;
  cast: () => PresetEntry[];
  onPick: (mention: Mention) => void;
}): MentionPicker {
  const { field, mount, onPick } = deps;

  const list = document.createElement("div");
  list.className = "yui-uc__pop";
  list.id = LIST_ID;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  mount.prepend(list);

  field.setAttribute("role", "combobox");
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-controls", LIST_ID);
  field.setAttribute("aria-expanded", "false");

  let options: Array<{ id: string; el: HTMLElement }> = [];
  let active = -1;
  let fragment = "";

  const isOpen = (): boolean => !list.hidden;
  const fragmentBeforeCaret = (): RegExpExecArray | null =>
    FRAGMENT.exec(field.value.slice(0, field.selectionStart ?? field.value.length));

  function close(): void {
    list.hidden = true;
    active = -1;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
  }

  function activate(i: number): void {
    if (options.length === 0) return;
    active = ((i % options.length) + options.length) % options.length;
    for (const [j, o] of options.entries())
      o.el.setAttribute("aria-selected", String(j === active));
    field.setAttribute("aria-activedescendant", options[active]!.el.id);
  }

  function open(next: string): void {
    fragment = next;
    const prefix = fragment.toLowerCase();
    const matches = deps.cast().filter((e) => e.name.toLowerCase().startsWith(prefix));
    options = [];
    list.replaceChildren();
    const add = (id: string, label: string, icon: HTMLElement | null, sub?: string): void => {
      const el = document.createElement("div");
      el.className = "yui-uc__opt";
      el.id = `${LIST_ID}-${options.length}`;
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", "false");
      if (icon) el.append(icon);
      const name = document.createElement("span");
      name.className = "yui-uc__opt-name";
      name.textContent = label;
      el.append(name);
      if (sub) {
        const s = document.createElement("span");
        s.className = "yui-uc__opt-sub";
        s.textContent = sub;
        el.append(s);
      }
      list.append(el);
      options.push({ id, el });
    };
    for (const e of matches) add(e.id, e.name, avatarEl(e, 14));
    add(EVERYONE, `@${EVERYONE}`, null, t("unified.everyone_sub"));
    list.hidden = false;
    field.setAttribute("aria-expanded", "true");
    // Enter picks the first match; with none, it still sends the text.
    if (matches.length > 0) activate(0);
    else active = -1;
  }

  function pick(id: string): void {
    const m = fragmentBeforeCaret();
    if (m) {
      const caret = field.selectionStart ?? field.value.length;
      const start = caret - m[2]!.length - 1;
      field.value = field.value.slice(0, start) + field.value.slice(caret);
      field.setSelectionRange(start, start);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    close();
    onPick(id);
  }

  function onCaret(): void {
    const m = fragmentBeforeCaret();
    if (m) open(m[2]!);
    else close();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!isOpen() || e.isComposing || e.keyCode === 229) return;
    const consume = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === "Escape") {
      consume();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      consume();
      activate(
        active === -1
          ? e.key === "ArrowDown"
            ? 0
            : -1
          : active + (e.key === "ArrowDown" ? 1 : -1),
      );
    } else if ((e.key === "Enter" || isTabPick(e)) && active !== -1) {
      consume();
      pick(options[active]!.id);
    }
  }

  function onListMousedown(e: MouseEvent): void {
    // Lands before the field's blur — focus stays on the field.
    e.preventDefault();
    const hit = options.find((o) => o.el.contains(e.target as Node));
    if (hit) pick(hit.id);
  }

  // Capture, registered before the text input's own handler, so a consumed Enter or Escape never reaches it.
  field.addEventListener("keydown", onKeydown, true);
  field.addEventListener("input", onCaret);
  field.addEventListener("click", onCaret);
  field.addEventListener("blur", close);
  list.addEventListener("mousedown", onListMousedown);

  return {
    refresh() {
      if (!isOpen()) return;
      const keep = active;
      open(fragment);
      if (keep !== -1 && options.length > 0) activate(keep);
    },
    dispose() {
      field.removeEventListener("keydown", onKeydown, true);
      field.removeEventListener("input", onCaret);
      field.removeEventListener("click", onCaret);
      field.removeEventListener("blur", close);
      list.remove();
    },
  };
}
