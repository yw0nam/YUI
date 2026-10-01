/**
 * Phone settings view — the full-screen sheet inside the phone root over stage and top row:
 * a head with back button and the selected tab's title, an icon rail, and the three tab bodies.
 * Owns open/close, the inert background, and the focus hand-off; the tabs themselves are built
 * by the wiring that mounts this view.
 */

import "./phone-settings.css";
// The tab bodies reuse the shared panel rows and fields — bring their stylesheets.
import "../../quick-controls/controls.css";
import "../../quick-controls/quick-controls.css";
import { t } from "../../i18n";
import { TAB_ICON_CHAR, TAB_ICON_CONN, TAB_ICON_HIST } from "../../quick-controls/constants";
import { createTabRail, tabButtonHtml } from "../../quick-controls/tabs/tab-rail";

/** The phone's settings tabs. */
export type PhoneSettingsTab = "conn" | "char" | "hist";

export interface PhoneSettingsView {
  el: HTMLElement;
  /** Open on a tab: refresh every tab, pull the background inert, focus the selected tab. */
  open(tab: PhoneSettingsTab): void;
  /** Close: commit the connection tab and hand focus back to the opener. */
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const BACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;

export function createPhoneSettingsView(deps: {
  mount: HTMLElement;
  connection: { el: HTMLElement; refresh(): void; commit(): void };
  character: { el: HTMLElement; refresh(): void };
  history: { el: HTMLElement; refresh(): void };
  /** Runs after every close, whatever drove it — the wiring releases its back claim here. */
  onClose?: () => void;
}): PhoneSettingsView {
  const { mount, connection, character, history, onClose } = deps;

  const el = document.createElement("div");
  el.className = "yui-phone-settings";
  el.hidden = true;
  el.innerHTML = `
      <div class="yui-phone-settings__head">
        <button class="yui-phone-settings__back" type="button" aria-label="${t("aria.back")}">${BACK_SVG}</button>
        <h2 class="yui-phone-settings__title"></h2>
      </div>
      <div class="yui-phone-settings__body">
        <div class="yui-phone-settings__rail" role="tablist" aria-label="${t("panel.tablist_label")}" aria-orientation="vertical">${tabButtonHtml("conn", TAB_ICON_CONN, { label: false })}${tabButtonHtml("char", TAB_ICON_CHAR, { label: false })}${tabButtonHtml("hist", TAB_ICON_HIST, { label: false })}</div>
        <div class="yui-phone-settings__tabs"></div>
      </div>`;

  // One panel per tab, each wrapping the tab element the wiring built.
  const tabsEl = el.querySelector<HTMLElement>(".yui-phone-settings__tabs")!;
  const panels: HTMLElement[] = [];
  for (const [id, tabEl] of [
    ["conn", connection.el],
    ["char", character.el],
    ["hist", history.el],
  ] as const) {
    const panel = document.createElement("div");
    panel.className = "yui-phone-settings__panel";
    panel.id = `yui-panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `yui-tab-${id}`);
    panel.tabIndex = 0;
    panel.hidden = true;
    panel.append(tabEl);
    tabsEl.append(panel);
    panels.push(panel);
  }

  const titleEl = el.querySelector<HTMLElement>(".yui-phone-settings__title")!;

  const rail = createTabRail({
    rail: el.querySelector<HTMLElement>(".yui-phone-settings__rail")!,
    buttons: Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab")),
    panels,
    initial: "conn",
    onSelect: (id) => {
      titleEl.textContent = t(`tabs.${id}`);
    },
  });

  let openState = false;
  let opener: HTMLElement | null = null;

  function setBackground(hidden: boolean): void {
    for (const child of mount.children) {
      if (child === el) continue;
      child.toggleAttribute("inert", hidden);
      if (hidden) child.setAttribute("aria-hidden", "true");
      else child.removeAttribute("aria-hidden");
    }
  }

  function open(tab: PhoneSettingsTab): void {
    rail.select(tab);
    if (openState) return;
    openState = true;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.hidden = false;
    setBackground(true);
    connection.refresh();
    character.refresh();
    history.refresh();
    rail.select(tab, { focusVisible: false });
  }

  function close(): void {
    if (!openState) return;
    openState = false;
    connection.commit();
    el.hidden = true;
    setBackground(false);
    opener?.focus();
    opener = null;
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  el.addEventListener("keydown", handleKeydown);
  el.querySelector<HTMLButtonElement>(".yui-phone-settings__back")!.addEventListener(
    "click",
    close,
  );
  mount.append(el);

  return {
    el,
    open,
    close,
    isOpen: () => openState,
    dispose(): void {
      if (openState) {
        openState = false;
        connection.commit();
        el.hidden = true;
        setBackground(false);
        opener = null;
      }
      el.querySelector<HTMLButtonElement>(".yui-phone-settings__back")!.removeEventListener(
        "click",
        close,
      );
      el.removeEventListener("keydown", handleKeydown);
      rail.dispose();
      el.remove();
    },
  };
}
