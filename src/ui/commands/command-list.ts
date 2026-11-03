import "./command-list.css";
import type { BackendCommand } from "../../io/chat/push/push-frames";
import { subscribe, t } from "../i18n";
import { createListbox } from "../listbox/listbox";
import { attachDragScroll } from "./drag-scroll";

export function createCommandList({
  field,
  mount,
  commands,
  label = () => t("command.list_label"),
}: {
  field: HTMLTextAreaElement;
  mount: HTMLElement;
  commands: () => BackendCommand[];
  label?: () => string;
}): { refresh(): void; close(): void; dispose(): void } {
  const root = document.createElement("div");
  root.className = "yui-cmd-list";
  root.hidden = true;
  const rows = document.createElement("div");
  rows.className = "yui-cmd-list__rows";
  rows.id = `yui-cmd-list-${crypto.randomUUID()}`;
  const footer = document.createElement("div");
  footer.className = "yui-cmd-list__footer";
  const count = document.createElement("span");
  const usage = document.createElement("span");
  footer.append(count, usage);
  root.append(rows, footer);
  mount.prepend(root);
  let matches: BackendCommand[] = [];
  const box = createListbox({
    field,
    root: rows,
    container: root,
    onPick: (id) => pick(Number(id)),
    passEnter: () => commands().some((cmd) => field.value === `/${cmd.name}`),
    onActivate(index) {
      (rows.children[index] as HTMLElement).scrollIntoView?.({ block: "nearest" });
      const cmd = matches[index]!;
      usage.textContent = `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`;
    },
  });
  const { close } = box;
  function refresh(reset = false): void {
    const active = reset ? 0 : Math.max(0, box.active());
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
      const name = document.createElement("span");
      name.textContent = `/${cmd.name}`;
      const description = document.createElement("span");
      description.className = "yui-cmd-list__description";
      description.textContent = cmd.description;
      row.append(name, description);
      rows.append(row);
    }
    rows.setAttribute("aria-label", label());
    count.textContent = t("command.count", { n: matches.length });
    box.set([...rows.children].map((el, i) => ({ id: String(i), el: el as HTMLElement })));
    box.open();
    box.activate(Math.min(active, matches.length - 1));
  }
  function pick(index: number): void {
    field.value = `/${matches[index]!.name} `;
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  }
  function onInput(): void {
    refresh(true);
  }
  const offDragScroll = attachDragScroll(rows, box.pickTarget);
  field.addEventListener("input", onInput);
  const offLocale = subscribe(() => {
    if (!root.hidden) refresh();
  });
  return {
    refresh,
    close,
    dispose() {
      offLocale();
      field.removeEventListener("input", onInput);
      offDragScroll();
      box.dispose();
      root.remove();
    },
  };
}
