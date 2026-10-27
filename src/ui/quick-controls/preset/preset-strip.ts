/**
 * Preset strip — the character header and the dots button that opens the manage popover, above
 * the tab rail and body, with the edited preset's note and relation line under it. Picking a
 * character hands its id to `onEditTarget`. Also fills each page's scope line and the rail's
 * character group heading.
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
import { createCharacterHeader } from "./character-header";
import { createPresetManage } from "./preset-manage";
import { presetScopeText } from "./preset-scope";
import { createPresetRelations } from "./relations/relations-section";

const DOTS_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`;

export function presetStripHtml(): string {
  return `
    <div class="yui-preset">
      <div class="yui-preset__row">
        <button class="yui-iconbtn yui-preset__manage" type="button" aria-label="${t("preset.manage")}" data-tip="${t("preset.manage")}" aria-haspopup="dialog" aria-expanded="false">${DOTS_SVG}</button>
      </div>
      <p class="yui-preset__note"></p>
      <div class="yui-preset-pop" role="dialog" aria-label="${t("preset.manage")}" hidden></div>
    </div>`;
}

export interface PresetStrip {
  /** Closes the manage popover — the panel closed. */
  close(): void;
  dispose(): void;
}

export function createPresetStrip(deps: {
  /** Panel root holding the strip markup and the scope lines it fills. */
  root: HTMLElement;
  registry: Pick<
    PresetRegistry,
    "get" | "subscribe" | "activate" | "create" | "rename" | "remove" | "setThumbnail"
  >;
  log: Logger;
  petWindows?: PetWindows;
  boundId?: string | null;
  /** Takes the picked preset as the one the window edits. */
  onEditTarget: (id: string) => void;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  /** This window's preset's relations; absent, the strip shows no relation line. */
  relationsStore?: RelationsStore;
  /** The Relations switch; off, the relation line hides. */
  relationsSwitch: FlagSettingsStore;
  /** Deletes a removed preset's thumbnail file; injected by the app wiring. */
  removeCardThumbnail?: (id: string) => Promise<void>;
  /** Opens the photo picker for a preset; injected under Tauri. */
  pickPhoto?: (presetId: string) => Promise<string | null>;
  /** The bundled chat transport, for a preset without its own; the edit header names it. */
  getDefaultChatApi?: () => string | undefined;
}): PresetStrip {
  const { root, registry, log, petWindows, boundId = null, onEditTarget } = deps;
  const shownId = presetIdForWindow();
  const isOpen = (id: string): boolean =>
    !!(petWindows?.get().includes(id) || isPresetWindowLive(id));
  const stripEl = root.querySelector<HTMLDivElement>(".yui-preset")!;
  const manageBtn = stripEl.querySelector<HTMLButtonElement>(".yui-preset__manage")!;
  const noteEl = stripEl.querySelector<HTMLParagraphElement>(".yui-preset__note")!;
  const header = createCharacterHeader({
    shownId,
    getDefaultChatApi: deps.getDefaultChatApi,
    onPick: onEditTarget,
  });
  manageBtn.before(header.el);
  const popEl = stripEl.querySelector<HTMLDivElement>(".yui-preset-pop")!;
  const manage = createPresetManage({
    el: popEl,
    registry,
    log,
    petWindows,
    boundId,
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
        anchor: noteEl,
        store: deps.relationsStore,
        presets: () => registry.get().list,
        isOpen,
        relationsSwitch: deps.relationsSwitch,
      })
    : null;
  let left = false;

  function render(): void {
    // The window reloads into the picked preset; until then it keeps showing this one.
    if (left) return;
    const state = registry.get();
    if (!state.list.some((e) => e.id === shownId)) {
      left = true;
      onEditTarget(boundId ?? state.active);
      return;
    }
    const name = presetNameFor(state, shownId);
    header.render(state.list, state.active, isOpen);
    const key = shownId === state.active ? "main" : isOpen(shownId) ? "window" : "idle";
    noteEl.textContent = t(`preset.note_${key}`, { name });
    for (const line of root.querySelectorAll<HTMLElement>("[data-scope-tab]")) {
      line.textContent = presetScopeText(line.dataset.scopeTab!, name);
    }
    const group = root.querySelector<HTMLElement>('[data-rail-group="character"]');
    if (group) group.textContent = name;
    relations?.render();
    if (!popEl.hidden) manage.render();
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
    const target = e.target as Element;
    if (target.closest?.("dialog[open]")) return;
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
      manageBtn.removeEventListener("click", handleManageClick);
      popEl.removeEventListener("keydown", handlePopKeydown);
    },
  };
}
