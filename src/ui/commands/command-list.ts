import "./command-list.css";
import type { BackendCommand } from "../../io/chat/push/push-frames";
import { subscribe, t } from "../i18n";
import { attachDragScroll } from "./drag-scroll";

export function createCommandList({
  field,
  mount,
  commands,
}: {
  field: HTMLTextAreaElement;
  mount: HTMLElement;
  commands: () => BackendCommand[];
}): { refresh(): void; close(): void; dispose(): void } {
  const root = document.createElement("div");
  root.className = "yui-cmd-list";
  root.hidden = true;
  const rows = document.createElement("div");
  rows.className = "yui-cmd-list__rows";
  rows.id = "yui-cmd-list";
  rows.setAttribute("role", "listbox");
  const footer = document.createElement("div");
  footer.className = "yui-cmd-list__footer";
  const count = document.createElement("span");
  const usage = document.createElement("span");
  footer.append(count, usage);
  root.append(rows, footer);
  mount.prepend(root);
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-controls", rows.id);
  field.setAttribute("aria-expanded", "false");
  let matches: BackendCommand[] = [];
  let active = 0;

  function close(): void {
    root.hidden = true;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
  }
  function activate(index: number): void {
    active = (index + matches.length) % matches.length;
    for (const [i, row] of [...rows.children].entries())
      row.setAttribute("aria-selected", String(i === active));
    const row = rows.children[active] as HTMLElement;
    field.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView?.({ block: "nearest" });
    const cmd = matches[active]!;
    usage.textContent = `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`;
  }
  function refresh(): void {
    const fragment = /^\/([a-z0-9_-]*)$/.exec(field.value);
    matches = fragment ? commands().filter((cmd) => cmd.name.startsWith(fragment[1]!)) : [];
    if (matches.length === 0) {
      close();
      return;
    }
    rows.replaceChildren();
    for (const [i, cmd] of matches.entries()) {
      const row = document.createElement("div");
      row.className = "yui-cmd-list__row";
      row.id = `${rows.id}-${i}`;
      row.setAttribute("role", "option");
      const name = document.createElement("span");
      name.textContent = `/${cmd.name}`;
      const description = document.createElement("span");
      description.className = "yui-cmd-list__description";
      description.textContent = cmd.description;
      row.append(name, description);
      rows.append(row);
    }
    rows.setAttribute("aria-label", t("command.list_label"));
    count.textContent = t("command.count", { n: matches.length });
    root.hidden = false;
    field.setAttribute("aria-expanded", "true");
    activate(Math.min(active, matches.length - 1));
  }
  function pick(index: number): void {
    field.value = `/${matches[index]!.name} `;
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  }
  function onInput(): void {
    active = 0;
    refresh();
  }
  function onKey(e: KeyboardEvent): void {
    if (root.hidden || e.isComposing || e.keyCode === 229 || (e.key === "Enter" && e.shiftKey))
      return;
    if (e.key === "Enter" && commands().some((cmd) => field.value === `/${cmd.name}`)) return;
    const tab = e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key) && !tab) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp")
      activate(active + (e.key === "ArrowDown" ? 1 : -1));
    else pick(active);
  }
  const offDragScroll = attachDragScroll(rows, (target) => {
    const index = [...rows.children].findIndex((row) => row.contains(target as Node));
    if (index !== -1) pick(index);
  });
  field.addEventListener("keydown", onKey, true);
  field.addEventListener("input", onInput);
  field.addEventListener("blur", close);
  const offLocale = subscribe(() => {
    if (!root.hidden) refresh();
  });
  return {
    refresh,
    close,
    dispose() {
      offLocale();
      field.removeEventListener("keydown", onKey, true);
      field.removeEventListener("input", onInput);
      field.removeEventListener("blur", close);
      offDragScroll();
      for (const attr of [
        "role",
        "aria-autocomplete",
        "aria-controls",
        "aria-expanded",
        "aria-activedescendant",
      ])
        field.removeAttribute(attr);
      root.remove();
    },
  };
}
