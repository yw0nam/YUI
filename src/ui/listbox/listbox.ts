interface Option {
  id: string;
  el: HTMLElement;
}
interface Owner {
  close(): void;
}
const fields = new WeakMap<HTMLTextAreaElement, { owners: Set<Owner>; open?: Owner }>();

export function createListbox(deps: {
  field: HTMLTextAreaElement;
  root: HTMLElement;
  container?: HTMLElement;
  onPick(id: string): void;
  onActivate?(index: number): void;
  passEnter?(): boolean;
}) {
  const { field, root } = deps;
  const container = deps.container ?? root;
  const state = fields.get(field) ?? { owners: new Set<Owner>() };
  fields.set(field, state);
  let options: Option[] = [];
  let active = -1;
  root.setAttribute("role", "listbox");
  container.hidden = true;
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-autocomplete", "list");
  if (state.owners.size === 0) {
    field.setAttribute("aria-controls", root.id);
    field.setAttribute("aria-expanded", "false");
  }
  const owner: Owner = { close };
  state.owners.add(owner);

  function close(): void {
    container.hidden = true;
    active = -1;
    if (state.open !== owner) return;
    state.open = undefined;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
  }
  function activate(index: number): void {
    if (!options.length) return;
    active = ((index % options.length) + options.length) % options.length;
    for (const [i, option] of options.entries())
      option.el.setAttribute("aria-selected", String(i === active));
    if (state.open === owner) field.setAttribute("aria-activedescendant", options[active]!.el.id);
    deps.onActivate?.(active);
  }
  function onKey(e: KeyboardEvent): void {
    if (
      state.open !== owner ||
      e.isComposing ||
      e.keyCode === 229 ||
      (e.key === "Enter" && e.shiftKey)
    )
      return;
    if (e.key === "Enter" && deps.passEnter?.()) return;
    const tab = e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key) && !tab) return;
    if ((e.key === "Enter" || tab) && active === -1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp")
      activate(
        active === -1
          ? e.key === "ArrowDown"
            ? 0
            : -1
          : active + (e.key === "ArrowDown" ? 1 : -1),
      );
    else deps.onPick(options[active]!.id);
  }
  field.addEventListener("keydown", onKey, true);
  field.addEventListener("blur", close);
  return {
    set(next: Option[]): void {
      options = next;
      active = -1;
      for (const option of options) {
        option.el.setAttribute("role", "option");
        option.el.setAttribute("aria-selected", "false");
      }
    },
    open(): void {
      if (state.open !== owner) state.open?.close();
      state.open = owner;
      container.hidden = false;
      field.setAttribute("aria-controls", root.id);
      field.setAttribute("aria-expanded", "true");
      field.removeAttribute("aria-activedescendant");
      if (active !== -1) activate(active);
    },
    isOpen: () => state.open === owner,
    active: () => active,
    activate,
    close,
    pickTarget(target: EventTarget | null): void {
      const hit = options.find((option) => target instanceof Node && option.el.contains(target));
      if (hit) deps.onPick(hit.id);
    },
    dispose(): void {
      close();
      state.owners.delete(owner);
      field.removeEventListener("keydown", onKey, true);
      field.removeEventListener("blur", close);
      if (state.owners.size) return;
      fields.delete(field);
      for (const attr of [
        "role",
        "aria-autocomplete",
        "aria-controls",
        "aria-expanded",
        "aria-activedescendant",
      ])
        field.removeAttribute(attr);
    },
  };
}
