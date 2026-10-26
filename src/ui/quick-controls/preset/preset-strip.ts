/**
 * Preset strip — the active preset's picker and the dots button that opens the manage popover,
 * above the tab rail and body, with the preset's relation line under it. Picking another preset activates it and holds the panel inert
 * until the window reloads (wire-preset); in edit mode (the settings window) it hands the picked
 * id to `onEditTarget` instead. Also fills each page's scope line and the rail's character group heading.
 */

import "./preset.css";
import type { Logger } from "../../../logger";
import {
  type createAgentNotifySettings,
  ingressUrl,
} from "../../../settings/backend/agent-notify-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import { presetIdForWindow, presetNameFor } from "../../../settings/preset/active-preset";
import { isPresetWindowLive, type PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { t } from "../../i18n";
import { createPresetManage } from "./preset-manage";
import { presetScopeText } from "./preset-scope";
import { createPresetRelations } from "./relations/relations-section";

const DOTS_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`;

export function presetStripHtml(): string {
  return `
    <div class="yui-preset">
      <div class="yui-preset__row">
        <label class="yui-preset__label" for="yui-preset-select">${t("preset.label")}</label>
        <img class="yui-preset__thumb" alt="" hidden />
        <select class="yui-select yui-preset__select" id="yui-preset-select"></select>
        <button class="yui-iconbtn yui-preset__manage" type="button" aria-label="${t("preset.manage")}" data-tip="${t("preset.manage")}" aria-haspopup="dialog" aria-expanded="false">${DOTS_SVG}</button>
      </div>
      <p class="yui-preset__note" hidden></p>
      <p class="yui-chat-status is-waiting yui-preset__state" role="status" hidden><span class="yui-chat-status__dot" aria-hidden="true"></span><span class="yui-preset__state-text"></span></p>
      <div class="yui-preset-pop" role="dialog" aria-label="${t("preset.manage")}" hidden></div>
    </div>`;
}

export interface PresetStrip {
  /** Closes the manage popover — the panel closed. */
  close(): void;
  dispose(): void;
}

export function createPresetStrip(deps: {
  /** Panel root holding the strip markup, the columns it disables, and the scope lines it fills. */
  root: HTMLElement;
  registry: Pick<
    PresetRegistry,
    "get" | "subscribe" | "activate" | "create" | "rename" | "remove" | "setThumbnail"
  >;
  log: Logger;
  petWindows?: PetWindows;
  boundId?: string | null;
  /** Passed in the settings window: the strip picks the preset the window edits instead of switching main's. */
  onEditTarget?: (id: string) => void;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  /** This window's preset's relations; absent, the strip shows no relation line. */
  relationsStore?: RelationsStore;
  /** The Relations switch; off, the relation line hides. */
  relationsSwitch: FlagSettingsStore;
  /** Deletes a removed preset's thumbnail file; injected by the app wiring. */
  removeCardThumbnail?: (id: string) => Promise<void>;
  /** Opens the photo picker for a preset; injected under Tauri. */
  pickPhoto?: (presetId: string) => Promise<string | null>;
}): PresetStrip {
  const { root, registry, log, petWindows, boundId = null, onEditTarget } = deps;
  const edit = !!onEditTarget;
  const shownId = presetIdForWindow();
  const isOpen = (id: string): boolean =>
    !!(petWindows?.get().includes(id) || isPresetWindowLive(id));
  const stripEl = root.querySelector<HTMLDivElement>(".yui-preset")!;
  const select = stripEl.querySelector<HTMLSelectElement>(".yui-preset__select")!;
  let boundName: HTMLSpanElement | null = null;
  if (boundId !== null && !edit) {
    boundName = document.createElement("span");
    boundName.className = "yui-preset__bound";
    boundName.setAttribute("role", "group");
    boundName.setAttribute("aria-label", t("preset.label"));
    select.replaceWith(boundName);
    stripEl.querySelector("label")!.removeAttribute("for");
  }
  const manageBtn = stripEl.querySelector<HTMLButtonElement>(".yui-preset__manage")!;
  const noteEl = stripEl.querySelector<HTMLParagraphElement>(".yui-preset__note")!;
  if (edit) {
    stripEl.querySelector("label")!.textContent = t("preset.edit_label");
    noteEl.hidden = false;
  }
  const stateEl = stripEl.querySelector<HTMLParagraphElement>(".yui-preset__state")!;
  const thumbEl = stripEl.querySelector<HTMLImageElement>(".yui-preset__thumb")!;
  const popEl = stripEl.querySelector<HTMLDivElement>(".yui-preset-pop")!;
  const colsEl = root.querySelector<HTMLDivElement>(".yui-quick__cols")!;
  const manage = createPresetManage({
    el: popEl,
    registry,
    log,
    petWindows,
    boundId,
    edit,
    removeCardThumbnail: deps.removeCardThumbnail,
    pickPhoto: deps.pickPhoto,
    presetUrl: (id) => {
      const settings = deps.agentNotifySettings?.get();
      return settings?.enabled ? ingressUrl(settings.port, id) : null;
    },
  });
  const relations = deps.relationsStore
    ? createPresetRelations({
        strip: stripEl,
        anchor: edit ? noteEl : stripEl.querySelector<HTMLElement>(".yui-preset__row")!,
        store: deps.relationsStore,
        presets: () => registry.get().list,
        isOpen,
        relationsSwitch: deps.relationsSwitch,
      })
    : null;
  let switching = false;
  let left = false;

  function render(): void {
    // The window reloads into the picked preset; until then it keeps showing the switch.
    if (switching || left) return;
    const state = registry.get();
    const shown = state.list.find((e) => e.id === shownId);
    thumbEl.hidden = !shown?.thumbnail;
    if (shown?.thumbnail) thumbEl.src = shown.thumbnail;
    if (edit && !state.list.some((e) => e.id === shownId)) {
      left = true;
      onEditTarget?.(boundId ?? state.active);
      return;
    }
    select.replaceChildren(
      ...state.list.map((e) => {
        const open = !edit && isOpen(e.id);
        const option = new Option(
          open ? t("preset.in_window", { name: e.name }) : e.name,
          e.id,
          false,
          e.id === shownId,
        );
        option.disabled = !!open;
        return option;
      }),
    );
    const name = presetNameFor(state, shownId);
    if (edit) {
      const open = isOpen(shownId);
      const key = shownId === state.active ? "main" : open ? "window" : "idle";
      noteEl.textContent = t(`preset.note_${key}`, { name });
    }
    if (boundName) boundName.textContent = name;
    for (const line of root.querySelectorAll<HTMLElement>("[data-scope-tab]")) {
      line.textContent = presetScopeText(line.dataset.scopeTab!, name);
    }
    const group = root.querySelector<HTMLElement>('[data-rail-group="character"]');
    if (group) group.textContent = name;
    relations?.render();
    if (!popEl.hidden) manage.render();
  }

  function handleChange(): void {
    if (edit) {
      if (select.value !== shownId) onEditTarget?.(select.value);
      return;
    }
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
  const offIngressUrl = deps.agentNotifySettings?.subscribe(render);
  render();

  return {
    close: () => closeManage(false),
    dispose(): void {
      closeManage(false);
      unsubscribe();
      offWindows?.();
      offIngressUrl?.();
      relations?.dispose();
      select.removeEventListener("change", handleChange);
      manageBtn.removeEventListener("click", handleManageClick);
      popEl.removeEventListener("keydown", handlePopKeydown);
    },
  };
}
