/**
 * The chat model input as a combobox — the server's model ids filter beneath the input while it
 * holds focus. Picks are reported; the input's value and its commit stay with the section.
 */

import { t } from "../../../i18n";
import "./model-combobox.css";

const LIST_ID = "yui-chat-model-list";

export interface ModelCombobox {
  /** Replaces the offered ids and refilters against the input's current value. */
  setOptions(ids: readonly string[]): void;
  /** Closes the list, keeping the offered ids. */
  closeList(): void;
  dispose(): void;
}

export function createModelCombobox(deps: {
  input: HTMLInputElement;
  onPick: (id: string) => void;
}): ModelCombobox {
  const { input, onPick } = deps;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", LIST_ID);

  const list = document.createElement("ul");
  list.className = "yui-model-list";
  list.id = LIST_ID;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  // The listbox takes the model row's existing label as its accessible name.
  const label = input.closest<HTMLElement>(".yui-input-row")?.querySelector("label");
  if (label) {
    if (label.id === "") label.id = `${LIST_ID}-label`;
    list.setAttribute("aria-labelledby", label.id);
  }
  // The no-match note is no option — a status element beside the listbox, shown while it hides.
  const none = document.createElement("p");
  none.className = "yui-model-list__none";
  none.setAttribute("role", "status");
  none.textContent = t("svc.chat_models_no_match");
  none.hidden = true;
  // Normal flow directly beneath the input — the row wraps them onto their own line.
  input.closest<HTMLElement>(".yui-input-row")!.append(list, none);

  let ids: readonly string[] = [];
  let active = -1;

  function options(): HTMLLIElement[] {
    return [...list.querySelectorAll<HTMLLIElement>(".yui-model-list__opt")];
  }

  function filtered(): string[] {
    const q = input.value.toLowerCase();
    return ids.filter((id) => id.toLowerCase().includes(q));
  }

  function close(): void {
    list.hidden = true;
    none.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function render(): void {
    // Open only while the input holds focus and there is something to offer.
    if (ids.length === 0 || document.activeElement !== input) {
      close();
      return;
    }
    const matches = filtered();
    list.replaceChildren();
    active = -1;
    if (matches.length === 0) {
      // Nothing matches: the typed name is kept — say so outside the listbox.
      none.hidden = false;
      list.hidden = true;
    } else {
      none.hidden = true;
      for (const [i, id] of matches.entries()) {
        const opt = document.createElement("li");
        opt.className = "yui-model-list__opt";
        opt.id = `${LIST_ID}-opt-${i}`;
        opt.setAttribute("role", "option");
        opt.setAttribute("aria-selected", "false");
        opt.textContent = id;
        list.append(opt);
      }
      list.hidden = false;
    }
    input.setAttribute("aria-expanded", "true");
  }

  function activate(i: number): void {
    const opts = options();
    if (opts.length === 0) return;
    active = ((i % opts.length) + opts.length) % opts.length;
    for (const [j, opt] of opts.entries()) opt.setAttribute("aria-selected", String(j === active));
    input.setAttribute("aria-activedescendant", opts[active]!.id);
    opts[active]?.scrollIntoView?.({ block: "nearest" });
  }

  function pick(id: string): void {
    close();
    onPick(id);
  }

  function handleInput(): void {
    render();
  }
  function handleFocus(): void {
    render();
  }
  function handleBlur(): void {
    close();
  }
  function handleKeydown(e: KeyboardEvent): void {
    // WKWebView commits an IME composition with isComposing false and keyCode 229.
    if (e.isComposing || e.keyCode === 229) return;
    const open = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open && ids.length === 0) return; // native caret — there is nothing to offer
      e.preventDefault();
      if (!open) {
        // A closed list reopens onto the end the arrow points at.
        render();
        const count = options().length;
        if (count > 0) activate(e.key === "ArrowDown" ? 0 : count - 1);
        return;
      }
      const count = options().length;
      if (count === 0) return;
      activate(
        active === -1
          ? e.key === "ArrowDown"
            ? 0
            : count - 1
          : active + (e.key === "ArrowDown" ? 1 : -1),
      );
    } else if (e.key === "Enter") {
      if (!open || active === -1) return;
      e.preventDefault();
      const id = options()[active]?.textContent;
      if (id) pick(id);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      close();
      // The list owns this Escape — the panel's document handler must not close on it.
      e.stopPropagation();
    }
  }
  function handleListMousedown(e: MouseEvent): void {
    // Lands before the input's blur dismissal — focus stays on the input.
    e.preventDefault();
    const id = (e.target as HTMLElement).closest<HTMLLIElement>(
      ".yui-model-list__opt",
    )?.textContent;
    if (id) pick(id);
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", handleFocus);
  input.addEventListener("blur", handleBlur);
  input.addEventListener("keydown", handleKeydown);
  list.addEventListener("mousedown", handleListMousedown);

  return {
    setOptions(next) {
      ids = next;
      render();
    },
    closeList: close,
    dispose(): void {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("blur", handleBlur);
      input.removeEventListener("keydown", handleKeydown);
      list.removeEventListener("mousedown", handleListMousedown);
      input.removeAttribute("role");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
      list.remove();
      none.remove();
    },
  };
}
