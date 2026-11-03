/**
 * The @ list over the unified chat window's field — a combobox listbox after the model combobox:
 * it opens on an `@` fragment before the caret, filters the open presets by name and offers
 * @everyone. Enter and Tab pick the highlighted option; a pick removes the fragment and reports
 * the choice.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { createListbox } from "../listbox/listbox";
import { avatarEl } from "./avatar";
import { EVERYONE, type Mention } from "./targets";

const LIST_ID = "yui-uc-mention-list";
/** Matches the `@fragment` that ends the text before the caret. */
const FRAGMENT = /(^|\s)@([^\s@]*)$/;

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
  list.hidden = true;
  mount.prepend(list);

  let options: Array<{ id: string; el: HTMLElement }> = [];
  const box = createListbox({ field, root: list, onPick: pick });
  const { close, activate, isOpen } = box;
  let fragment = "";

  const fragmentBeforeCaret = (): RegExpExecArray | null =>
    FRAGMENT.exec(field.value.slice(0, field.selectionStart ?? field.value.length));

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
    box.set(options);
    box.open();
    if (matches.length > 0) activate(0);
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

  function onListMousedown(e: MouseEvent): void {
    // Lands before the field's blur — focus stays on the field.
    e.preventDefault();
    box.pickTarget(e.target);
  }

  field.addEventListener("input", onCaret);
  field.addEventListener("click", onCaret);
  list.addEventListener("mousedown", onListMousedown);

  return {
    refresh() {
      if (!isOpen()) return;
      const keep = box.active();
      open(fragment);
      if (keep !== -1 && options.length > 0) activate(keep);
    },
    dispose() {
      box.dispose();
      field.removeEventListener("input", onCaret);
      field.removeEventListener("click", onCaret);
      list.remove();
    },
  };
}
