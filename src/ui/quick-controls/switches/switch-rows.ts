/**
 * Switch rows: the row markup, the click binding that flips a row's store and logs it, the repaint
 * from the stores, and, given an open state, the store following that repaints while the panel is
 * open.
 */

import type { Logger } from "../../../logger";
import { t } from "../../i18n";
import type { SwitchRow } from "../switch-row";

export function switchButtonHtml(row: SwitchRow): string {
  return `<button class="yui-switch ${row.selector.slice(1)}" type="button" role="switch" aria-checked="${String(row.initialEnabled)}" aria-label="${t(row.ariaKey)}"></button>`;
}

export function switchRowHtml(row: SwitchRow): string {
  const label = `<span class="yui-row__label">${row.labelIcon ?? ""}${t(row.labelKey)}</span>`;
  const sub = row.subKey ? `<span class="yui-row__sub">${t(row.subKey)}</span>` : "";
  return `
          <div class="yui-row">
            <div class="yui-row__main">${label}${sub}</div>
            ${switchButtonHtml(row)}
          </div>`;
}

/** Set each visible, available row's switch from its store, and a locked row's switch off with its reason. */
export function reflectSwitchRows(root: HTMLElement, rows: readonly SwitchRow[]): void {
  for (const row of rows) {
    if (!row.isVisible || !row.isAvailable) continue;
    const button = root.querySelector<HTMLButtonElement>(row.selector);
    button?.setAttribute("aria-checked", String(row.getEnabled()));
    if (!button || !row.lock) continue;
    const locked = row.lock.get();
    button.disabled = locked;
    const sub = button.closest(".yui-row")?.querySelector(".yui-row__sub");
    if (sub) sub.textContent = locked ? t(row.lock.reasonKey) : row.subKey ? t(row.subKey) : "";
  }
}

/**
 * Bind each row's switch under `root`; a click flips the row's store and logs its `logKey`.
 * With `isOpen`, each row that has `subscribe` repaints the rows on a store change while open.
 */
export function bindSwitchRows(
  root: HTMLElement,
  rows: readonly SwitchRow[],
  log: Logger,
  isOpen?: () => boolean,
): { reflect(): void; dispose(): void } {
  const handleClick = (row: SwitchRow): void => {
    if (!row.isAvailable || row.lock?.get()) return;
    const next = !row.getEnabled();
    row.setEnabled(next);
    if (row.logKey) log.info(row.logKey, { enabled: next });
  };
  const bound = rows.map((row) => {
    const button = root.querySelector<HTMLButtonElement>(row.selector);
    const onClick = (): void => handleClick(row);
    button?.addEventListener("click", onClick);
    return () => button?.removeEventListener("click", onClick);
  });
  const followed = isOpen
    ? rows.flatMap((row) =>
        [row.subscribe, row.lock?.subscribe].flatMap((subscribe) =>
          subscribe
            ? [
                subscribe(() => {
                  if (isOpen()) reflectSwitchRows(root, rows);
                }),
              ]
            : [],
        ),
      )
    : [];
  return {
    reflect: () => reflectSwitchRows(root, rows),
    dispose: () => {
      for (const unbind of bound) unbind();
      for (const unsubscribe of followed) unsubscribe();
    },
  };
}
