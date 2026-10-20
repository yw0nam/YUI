/**
 * Preset strip — the active preset's picker and the dots button that opens the manage popover,
 * above the tab rail and body. Picking another preset activates it and holds the panel inert
 * until the window reloads (wire-preset). Also fills each tab's scope line.
 */

import "./preset.css";
import type { Logger } from "../../../logger";
import type { PresetState } from "../../../settings/preset/active-preset";
import { isPetWindowLive, type PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { t } from "../../i18n";
import { createPresetManage } from "./preset-manage";
import { presetScopeText } from "./preset-scope";

const PET_WINDOWS_UI = false;

const DOTS_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`;

export function presetStripHtml(): string {
  return `
    <div class="yui-preset">
      <div class="yui-preset__row">
        <label class="yui-preset__label" for="yui-preset-select">${t("preset.label")}</label>
        <select class="yui-select yui-preset__select" id="yui-preset-select"></select>
        <button class="yui-iconbtn yui-preset__manage" type="button" aria-label="${t("preset.manage")}" data-tip="${t("preset.manage")}" aria-haspopup="dialog" aria-expanded="false">${DOTS_SVG}</button>
      </div>
      <p class="yui-chat-status is-waiting yui-preset__state" role="status" hidden><span class="yui-chat-status__dot" aria-hidden="true"></span><span class="yui-preset__state-text"></span></p>
      <div class="yui-preset-pop" role="dialog" aria-label="${t("preset.manage")}" hidden></div>
    </div>`;
}

export interface PresetStrip {
  /** Closes the manage popover — the panel closed. */
  close(): void;
  dispose(): void;
}

function activeName(state: PresetState): string {
  return state.list.find((e) => e.id === state.active)?.name ?? state.active;
}

export function createPresetStrip(deps: {
  /** Panel root holding the strip markup, the columns it disables, and the scope lines it fills. */
  root: HTMLElement;
  registry: Pick<PresetRegistry, "get" | "subscribe" | "activate" | "create" | "rename" | "remove">;
  log: Logger;
  petWindows?: PetWindows;
  boundId?: string | null;
  windowsUi?: boolean;
}): PresetStrip {
  const { root, registry, log, petWindows, boundId = null, windowsUi = PET_WINDOWS_UI } = deps;
  const stripEl = root.querySelector<HTMLDivElement>(".yui-preset")!;
  const select = stripEl.querySelector<HTMLSelectElement>(".yui-preset__select")!;
  let boundName: HTMLSpanElement | null = null;
  if (boundId !== null) {
    boundName = document.createElement("span");
    boundName.className = "yui-preset__bound";
    select.replaceWith(boundName);
    stripEl.querySelector("label")!.removeAttribute("for");
  }
  const manageBtn = stripEl.querySelector<HTMLButtonElement>(".yui-preset__manage")!;
  const stateEl = stripEl.querySelector<HTMLParagraphElement>(".yui-preset__state")!;
  const popEl = stripEl.querySelector<HTMLDivElement>(".yui-preset-pop")!;
  const colsEl = root.querySelector<HTMLDivElement>(".yui-quick__cols")!;
  const manage = createPresetManage({ el: popEl, registry, log, petWindows, boundId, windowsUi });
  let switching = false;

  function render(): void {
    // The window reloads into the picked preset; until then it keeps showing the switch.
    if (switching) return;
    const state = registry.get();
    select.replaceChildren(
      ...state.list.map((e) => {
        const open = petWindows?.get().includes(e.id) || isPetWindowLive(e.id);
        const option = new Option(
          open ? t("preset.in_window", { name: e.name }) : e.name,
          e.id,
          false,
          e.id === state.active,
        );
        option.disabled = !!open;
        return option;
      }),
    );
    const name =
      boundId === null
        ? activeName(state)
        : (state.list.find((e) => e.id === boundId)?.name ?? boundId);
    if (boundName) boundName.textContent = name;
    for (const line of root.querySelectorAll<HTMLElement>("[data-scope-tab]")) {
      line.textContent = presetScopeText(line.dataset.scopeTab!, name);
    }
    if (!popEl.hidden) manage.render();
  }

  function handleChange(): void {
    const target = registry.get().list.find((e) => e.id === select.value);
    if (!target || target.id === registry.get().active) return;
    if (boundId !== null) return;
    if (!registry.activate(target.id)) {
      render();
      return;
    }
    closeManage(false);
    switching = true;
    stripEl.classList.add("is-busy");
    select.disabled = true;
    manageBtn.disabled = true;
    stateEl.querySelector(".yui-preset__state-text")!.textContent = t("preset.switching", {
      name: target.name,
    });
    stateEl.hidden = false;
    colsEl.classList.add("is-busy");
    colsEl.setAttribute("inert", "");
    log.info("preset_switch", { preset: target.id });
  }

  function openManage(): void {
    popEl.hidden = false;
    manageBtn.classList.add("is-pressed");
    manageBtn.setAttribute("aria-expanded", "true");
    manage.render();
    manage.focusFirst();
    document.addEventListener("pointerdown", handleOutsidePointer, true);
  }

  function closeManage(restoreFocus: boolean): void {
    if (popEl.hidden) return;
    document.removeEventListener("pointerdown", handleOutsidePointer, true);
    manage.reset();
    popEl.hidden = true;
    popEl.replaceChildren();
    manageBtn.classList.remove("is-pressed");
    manageBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) manageBtn.focus();
  }

  function handleOutsidePointer(e: PointerEvent): void {
    const target = e.target as Node;
    if (!popEl.contains(target) && !manageBtn.contains(target)) closeManage(false);
  }

  function handleManageClick(): void {
    if (popEl.hidden) openManage();
    else closeManage(true);
  }

  // Esc closes the popover alone; the panel stays open behind it.
  function handlePopKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeManage(true);
  }

  select.addEventListener("change", handleChange);
  manageBtn.addEventListener("click", handleManageClick);
  popEl.addEventListener("keydown", handlePopKeydown);
  const unsubscribe = registry.subscribe(render);
  const offWindows = petWindows?.subscribe(render);
  render();

  return {
    close: () => closeManage(false),
    dispose(): void {
      closeManage(false);
      unsubscribe();
      offWindows?.();
      select.removeEventListener("change", handleChange);
      manageBtn.removeEventListener("click", handleManageClick);
      popEl.removeEventListener("keydown", handlePopKeydown);
    },
  };
}
