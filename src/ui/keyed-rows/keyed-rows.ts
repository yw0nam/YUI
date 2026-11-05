/** Keyed lists: a row keeps its node (and so its focus and pressed state) while its key stays in the list. */

const lists = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

/**
 * Makes `container` hold one row per item, in order. A key still present keeps its node and gets
 * `update` (default: `syncRow` from a fresh `create`); a new key gets `create`; any other child
 * leaves first, so a survivor moves only when its place changed. A key must change when the row's
 * element type must. Never touches focus.
 */
export function reconcileRows<T>(
  container: HTMLElement,
  items: readonly T[],
  opts: {
    key(item: T): string;
    create(item: T): HTMLElement;
    update?(row: HTMLElement, item: T): void;
  },
): void {
  const before = lists.get(container);
  const rows = new Map<string, HTMLElement>();
  const update = opts.update ?? ((row, item) => syncRow(row, opts.create(item)));
  for (const item of items) {
    const key = opts.key(item);
    const old = before?.get(key);
    const kept = old?.parentElement === container ? old : undefined;
    if (kept) update(kept, item);
    rows.set(key, kept ?? opts.create(item));
  }
  const keep = new Set(rows.values());
  for (const child of [...container.children]) if (!keep.has(child as HTMLElement)) child.remove();
  let cursor = container.firstElementChild;
  for (const row of keep) {
    if (row === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(row, cursor);
  }
  lists.set(container, rows);
}

/** Runs `render`; if it removed the focused button, focuses the button now at its index, else the container. */
export function keepFocus(container: HTMLElement, render: () => void): void {
  const buttons = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>("button")];
  const active = document.activeElement;
  const at = buttons().indexOf(active as HTMLElement);
  render();
  if (at < 0 || active?.isConnected) return;
  const next = buttons();
  const target = next[Math.min(at, next.length - 1)];
  if (target) target.focus({ preventScroll: true });
  else {
    container.tabIndex = -1;
    container.focus({ preventScroll: true });
  }
}

/** Copies `fresh` onto `row` in place: attributes, text and child elements are reused where the tags match. */
export function syncRow(row: Element, fresh: Element): void {
  for (const { name } of [...row.attributes])
    if (!fresh.hasAttribute(name)) row.removeAttribute(name);
  for (const { name, value } of fresh.attributes) {
    if (row.getAttribute(name) !== value) row.setAttribute(name, value);
  }
  const kids = [...fresh.childNodes];
  kids.forEach((kid, i) => {
    const cur = row.childNodes[i];
    if (!cur) row.append(kid);
    else if (cur.nodeName !== kid.nodeName) cur.replaceWith(kid);
    else if (kid instanceof Element) syncRow(cur as Element, kid);
    else if (cur.nodeValue !== kid.nodeValue) cur.nodeValue = kid.nodeValue;
  });
  while (row.childNodes.length > kids.length) row.lastChild!.remove();
}
