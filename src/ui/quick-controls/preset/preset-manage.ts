/**
 * Manage popover body — the preset rows with inline rename and two-step delete, and the new-preset
 * row that turns into a name field. Writes go to the registry; its notify re-renders through the strip.
 */

import type { Logger } from "../../../logger";
import type { PresetEntry, PresetState } from "../../../settings/preset/active-preset";
import { isPetWindowLive, type PetWindows } from "../../../settings/preset/pet-windows";
import { DEFAULT_PRESET_ID } from "../../../settings/preset/preset-keys";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { t } from "../../i18n";
import { PLUS_SVG } from "../constants";
import { REMOVE_SVG, RENAME_SVG } from "../sections/user-asset-list";

type Registry = Pick<PresetRegistry, "get" | "create" | "rename" | "remove">;

export interface PresetManage {
  render(): void;
  /** Drops a rename, a confirm, or a name being typed — the popover closed. */
  reset(): void;
  focusFirst(): void;
}

function hintHtml(actionKey: string): string {
  return `<kbd>Enter</kbd> ${t(actionKey)} · <kbd>Esc</kbd> ${t("preset.hint_cancel")}`;
}

export function createPresetManage(deps: {
  el: HTMLElement;
  registry: Registry;
  log: Logger;
  petWindows?: PetWindows;
  boundId?: string | null;
}): PresetManage {
  const { el, registry, log, petWindows, boundId } = deps;
  let renamingId: string | null = null;
  let confirmId: string | null = null;
  let naming = false;
  // The field keeps what was typed across a re-render (another window's edit lands mid-typing).
  let draft = "";
  // The control to focus after the next render, so keyboard users stay where they acted.
  let focusSel: string | null = null;

  function isTaken(state: PresetState, name: string, exceptId?: string): boolean {
    return state.list.some((e) => e.id !== exceptId && e.name === name.trim());
  }

  function rowEl(entry: PresetEntry, active: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-preset-row";
    row.dataset.presetId = entry.id;
    const desired = petWindows?.get().includes(entry.id) ?? false;
    const live = isPetWindowLive(entry.id);
    const removable =
      entry.id !== DEFAULT_PRESET_ID &&
      entry.id !== active &&
      entry.id !== boundId &&
      !desired &&
      !live;
    row.innerHTML = `
          <span class="yui-preset-row__name"></span>${entry.id === active ? `<span class="yui-preset-row__badge">${t("preset.in_use")}</span>` : ""}
          <span class="yui-preset-row__acts">
            <button class="yui-preset-row__rename" type="button">${RENAME_SVG}</button>${removable ? `<button class="yui-preset-row__remove" type="button">${REMOVE_SVG}</button>` : ""}
          </span>`;
    // Names are user input — text and attributes go through the DOM, never markup.
    row.querySelector(".yui-preset-row__name")!.textContent = entry.name;
    const renameBtn = row.querySelector<HTMLButtonElement>(".yui-preset-row__rename")!;
    renameBtn.setAttribute("aria-label", t("preset.rename", { name: entry.name }));
    renameBtn.addEventListener("click", () => {
      renamingId = entry.id;
      confirmId = null;
      focusSel = ".is-renaming input";
      render();
    });
    const removeBtn = row.querySelector<HTMLButtonElement>(".yui-preset-row__remove");
    removeBtn?.setAttribute("aria-label", t("preset.remove", { name: entry.name }));
    removeBtn?.addEventListener("click", () => {
      confirmId = entry.id;
      renamingId = null;
      focusSel = ".yui-preset-row__confirm .yui-pill:not(.yui-pill--go)";
      render();
    });
    if (petWindows && entry.id !== active && entry.id !== boundId) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yui-preset-row__window";
      button.textContent = t(desired || live ? "preset.close_window" : "preset.open_window");
      button.disabled = live && !desired;
      button.addEventListener("click", () =>
        desired ? petWindows.close(entry.id) : petWindows.open(entry.id),
      );
      row.querySelector(".yui-preset-row__acts")!.append(button);
    }
    return row;
  }

  function renamingEl(entry: PresetEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-preset-row yui-input-row is-renaming";
    row.innerHTML = `
          <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t("preset.name_aria")}" /></span>
          <span class="yui-preset-row__hint">${hintHtml("preset.hint_save")}</span>`;
    const input = row.querySelector("input")!;
    input.value = entry.name;
    input.addEventListener("input", () => {
      const taken = isTaken(registry.get(), input.value, entry.id);
      row.classList.toggle("is-invalid", taken);
      input.setAttribute("aria-invalid", String(taken));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      // Esc cancels the rename only; the popover and the panel stay open.
      e.stopPropagation();
      const next = input.value.trim();
      if (e.key === "Enter" && next !== entry.name) {
        if (!registry.rename(entry.id, next)) {
          row.classList.add("is-invalid");
          input.setAttribute("aria-invalid", "true");
          return;
        }
        log.info("preset_rename", { preset: entry.id });
      }
      renamingId = null;
      focusSel = `[data-preset-id="${entry.id}"] .yui-preset-row__rename`;
      render();
    });
    return row;
  }

  function confirmEl(entry: PresetEntry): HTMLElement {
    const box = document.createElement("div");
    box.className = "yui-confirm yui-preset-row__confirm";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", t("preset.remove", { name: entry.name }));
    box.innerHTML = `
          <span class="yui-confirm__q"></span>
          <span class="yui-confirm__btns">
            <button class="yui-pill" type="button">${t("preset.confirm_cancel")}</button>
            <button class="yui-pill yui-pill--go" type="button">${t("preset.confirm_go")}</button>
          </span>`;
    box.querySelector(".yui-confirm__q")!.textContent = t("preset.confirm_q", { name: entry.name });
    const [cancelBtn, goBtn] = Array.from(box.querySelectorAll<HTMLButtonElement>(".yui-pill"));
    cancelBtn.addEventListener("click", () => {
      confirmId = null;
      render();
    });
    goBtn.addEventListener("click", () => {
      confirmId = null;
      if (registry.remove(entry.id)) log.info("preset_remove", { preset: entry.id });
      focusSel = ".yui-add-btn";
      render();
    });
    return box;
  }

  function newFieldEl(state: PresetState): HTMLElement {
    const activeName = state.list.find((e) => e.id === state.active)?.name ?? "";
    const field = document.createElement("div");
    field.className = "yui-stack yui-input-row yui-preset-new";
    field.innerHTML = `
          <label class="yui-input-row__label" for="yui-preset-new-name">${t("preset.new")}</label>
          <span class="yui-row__sub"></span>
          <span class="yui-input-wrap"><input class="yui-ep-input" id="yui-preset-new-name" type="text" placeholder="${t("preset.new_ph")}" /></span>
          <p class="yui-input-row__error" role="status"></p>
          <span class="yui-preset-row__hint">${hintHtml("preset.hint_create")}</span>`;
    field.querySelector(".yui-row__sub")!.textContent = t("preset.new_sub", { name: activeName });
    const input = field.querySelector("input")!;
    const errorEl = field.querySelector(".yui-input-row__error")!;
    input.value = draft;
    const validate = (): boolean => {
      const taken = isTaken(registry.get(), input.value);
      field.classList.toggle("is-invalid", taken);
      input.setAttribute("aria-invalid", String(taken));
      errorEl.textContent = taken ? t("preset.taken", { name: input.value.trim() }) : "";
      return !taken;
    };
    validate();
    input.addEventListener("input", () => {
      draft = input.value;
      validate();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") {
        if (!validate() || !input.value.trim()) return;
        naming = false;
        draft = "";
        const id = registry.create(input.value);
        if (id) log.info("preset_create", { preset: id });
      } else {
        naming = false;
        draft = "";
      }
      focusSel = ".yui-add-btn";
      render();
    });
    return field;
  }

  function addRowEl(): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-row yui-row--action";
    row.innerHTML = `<button class="yui-add-btn" type="button">${PLUS_SVG}${t("preset.new")}</button>`;
    row.querySelector("button")!.addEventListener("click", () => {
      naming = true;
      renamingId = null;
      confirmId = null;
      focusSel = "#yui-preset-new-name";
      render();
    });
    return row;
  }

  function render(): void {
    const state = registry.get();
    // A preset removed in another window takes its pending rename or confirm with it.
    if (!state.list.some((e) => e.id === renamingId)) renamingId = null;
    if (!state.list.some((e) => e.id === confirmId)) confirmId = null;
    const group = document.createElement("div");
    group.className = "yui-group";
    for (const entry of state.list) {
      if (entry.id === renamingId) group.append(renamingEl(entry));
      else if (entry.id === confirmId) group.append(confirmEl(entry));
      else group.append(rowEl(entry, state.active));
    }
    group.append(naming ? newFieldEl(state) : addRowEl());
    el.replaceChildren(group);
    if (focusSel) {
      el.querySelector<HTMLElement>(focusSel)?.focus();
      focusSel = null;
    }
  }

  return {
    render,
    reset(): void {
      renamingId = null;
      confirmId = null;
      naming = false;
      draft = "";
    },
    focusFirst(): void {
      el.querySelector<HTMLElement>("button, input")?.focus();
    },
  };
}
