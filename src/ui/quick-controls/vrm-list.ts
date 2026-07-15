/** VRM list cluster — VRM radiogroup in Character tab: render, rename, import, swap, keyboard. */
import type { AvatarOption } from "../../config/load";
import type { createVrmSelection } from "../../io/vrm-selection";
import type { Logger } from "../../logger";
import { t } from "../i18n";

const VRM_RENAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const VRM_REMOVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

export interface VrmListDeps {
  /** Panel root (el) — query .yui-vrms / .yui-vrm__import-error from here. */
  root: HTMLElement;
  vrmSelection: ReturnType<typeof createVrmSelection>;
  /** Perform actual swap + commit store on success. Component does not call store.select directly. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** Full import flow: file select → load → addUserOption + select. Inline error on reject. */
  importVrm: () => Promise<void>;
  /** Delete imported VRM app-data file (idempotent). Called separately from store removal. */
  removeUserVrm: (id: string) => Promise<void>;
  log: Logger;
}

export interface VrmList {
  render(): void;
  handleKeydown(e: KeyboardEvent): void;
  handleAddClick(): void;
  /** Whether swap is in progress — used by entry's open-subscription guard. */
  isSwapping(): boolean;
}

export function createVrmList(deps: VrmListDeps): VrmList {
  const { vrmSelection, swapVrm, importVrm, removeUserVrm, log } = deps;
  const vrmsEl = deps.root.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmImportErrorEl = deps.root.querySelector<HTMLParagraphElement>(".yui-vrm__import-error")!;

  // Swapping id (guards duplicate swap) · last error row id (keeps inline guidance on re-render).
  let vrmSwapping: string | null = null;
  let vrmErrorId: string | null = null;
  // Last row id where arrow roved — kept so re-render doesn't snap roving tabindex back to active.
  // Deliberately not reset in close() — re-open continues from roved row, guarded by ids.includes.
  let vrmRovedId: string | null = null;
  // User option id being renamed inline (null if none) · whether import is in progress.
  let vrmRenamingId: string | null = null;
  let vrmImporting = false;

  function renderVrms(): void {
    const activeId = vrmSelection.getActiveId();
    const options = vrmSelection.list();
    // Roving tabindex prioritizes last roved row — falls back to active if none.
    const ids = options.map((o) => o.id);
    const rovedId = vrmRovedId !== null && ids.includes(vrmRovedId) ? vrmRovedId : activeId;
    // Clean up edit state if row being edited no longer in list.
    if (vrmRenamingId !== null && !ids.includes(vrmRenamingId)) vrmRenamingId = null;
    // innerHTML re-render destroys focused row — pre-record if it had focus, only restore if it did.
    const hadFocus = vrmsEl.contains(document.activeElement);
    vrmsEl.innerHTML = "";
    for (const opt of options) {
      const isUser = opt.source === "user";
      const selected = opt.id === activeId;
      // User row holds nested button/input so it's div[role=radio] (button-in-button is invalid HTML).
      const row = document.createElement(isUser ? "div" : "button");
      if (!isUser) (row as HTMLButtonElement).type = "button";
      row.setAttribute("role", "radio");
      row.className = "yui-vrm";
      row.dataset.vrmId = opt.id;
      row.setAttribute("aria-checked", String(selected));
      row.tabIndex = opt.id === rovedId ? 0 : -1;

      if (isUser && opt.id === vrmRenamingId) {
        renderRenamingRow(row, opt);
      } else {
        const badgeHtml = selected ? `<span class="yui-vrm__badge">${t("vrm.in_use")}</span>` : "";
        const actionsHtml = isUser
          ? `<button class="yui-vrm__rename" type="button" title="${t("vrm.rename")}" aria-label="${t("vrm.rename")}">${VRM_RENAME_SVG}</button>` +
            `<button class="yui-vrm__remove" type="button" title="${t("vrm.remove")}" aria-label="${t("vrm.remove")}">${VRM_REMOVE_SVG}</button>`
          : "";
        row.innerHTML = `
          <span class="yui-vrm__tick" aria-hidden="true"></span>
          <span class="yui-vrm__body"><span class="yui-vrm__name"></span></span>
          ${actionsHtml}
          ${badgeHtml}
        `;
        // Label may be untrusted input — set via textContent only.
        row.querySelector<HTMLSpanElement>(".yui-vrm__name")!.textContent = opt.label;
        row.addEventListener("click", () => {
          void swapTo(opt);
        });
        if (isUser) {
          row
            .querySelector<HTMLButtonElement>(".yui-vrm__rename")!
            .addEventListener("click", (e) => {
              e.stopPropagation(); // Rename does not trigger row selection
              startRename(opt.id);
            });
          row
            .querySelector<HTMLButtonElement>(".yui-vrm__remove")!
            .addEventListener("click", (e) => {
              e.stopPropagation(); // Remove does not trigger row selection
              void removeUserOption(opt.id);
            });
        }
      }

      vrmsEl.appendChild(row);

      // If previous error row, re-render as inactive and attach inline guidance below.
      if (opt.id === vrmErrorId) {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-vrm__error";
        err.setAttribute("role", "status");
        err.textContent = t("vrm.swap_error");
        vrmsEl.appendChild(err);
      }
    }

    // If import is in progress, append spinner placeholder row at end (not radio).
    if (vrmImporting) {
      const loading = document.createElement("div");
      loading.className = "yui-vrm__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-vrm__spin" aria-hidden="true"></span><span class="yui-vrm__loading-name">${t("vrm.loading")}</span>`;
      vrmsEl.appendChild(loading);
    }

    // If editing, focus input and exit (takes precedence over restoring roving focus).
    if (vrmRenamingId !== null) {
      const input = vrmsEl.querySelector<HTMLInputElement>(".yui-vrm--renaming .yui-ep-input");
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    // If radiogroup had focus before re-render, restore focus to roving row.
    if (hadFocus) {
      const roved = vrmRowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  // Render user row in inline rename mode — label becomes input, hint follows.
  function renderRenamingRow(row: HTMLElement, opt: AvatarOption): void {
    row.classList.add("yui-vrm--renaming");
    row.innerHTML = `
      <span class="yui-vrm__tick" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t("vrm.name_aria")}" /></span>
      <span class="yui-vrm__rename-hint"><kbd>Enter</kbd> ${t("vrm.rename_hint_save")} · <kbd>Esc</kbd> ${t("vrm.rename_hint_cancel")}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = opt.label;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename(opt.id, input.value);
      } else if (e.key === "Escape") {
        // Escape cancels rename only — does not propagate to panel close (document Escape).
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });
    // On blur, commit nonempty value.
    input.addEventListener("blur", () => {
      if (vrmRenamingId !== opt.id) return; // Already cleaned up by commit/cancel
      commitRename(opt.id, input.value);
    });
  }

  function startRename(id: string): void {
    vrmRenamingId = id;
    renderVrms();
  }

  function cancelRename(): void {
    if (vrmRenamingId === null) return;
    vrmRenamingId = null;
    renderVrms();
  }

  function commitRename(id: string, label: string): void {
    if (vrmRenamingId !== id) return;
    vrmRenamingId = null;
    // Empty/whitespace label is rejected by store (keeps existing label). Change triggers store subscription re-render.
    vrmSelection.renameUserOption(id, label);
    log.info("vrm_rename", { id });
    renderVrms();
  }

  // Remove user option — delete file first (success required, no store/disk mismatch), then
  // remove from store and swap to fallback if it was active.
  async function removeUserOption(id: string): Promise<void> {
    const wasActive = vrmSelection.getActiveId() === id;
    log.info("vrm_delete", { id });
    try {
      await removeUserVrm(id);
    } catch (err) {
      // File delete failed — do not commit store removal, keep row (maintain disk match).
      log.error("vrm_delete_failed", { id, error: String(err) });
      return;
    }
    vrmSelection.removeUserOption(id); // Falls back to default if was active + notify
    // Non-active removal does not notify store, so re-render list directly.
    if (!wasActive) {
      renderVrms();
      return;
    }
    // Active delete — load fallback option into renderer (store already points to default).
    try {
      await swapVrm(vrmSelection.getActive());
    } catch (err) {
      log.error("vrm_fallback_swap_failed", { error: String(err) });
      renderVrms(); // Swap failed, re-render list to match actual state.
    }
  }

  function setImportError(show: boolean): void {
    vrmImportErrorEl.hidden = !show;
  }

  // "Add from file…" — show importing row and delegate full import flow.
  // Success: store adds row (subscription → re-render); failure: show inline error.
  async function importVrmFlow(): Promise<void> {
    if (vrmImporting) return; // Prevent second import while in progress
    vrmImporting = true;
    setImportError(false);
    renderVrms();
    try {
      await importVrm();
    } catch (err) {
      setImportError(true);
      log.error("vrm_import_failed", { error: String(err) });
    } finally {
      vrmImporting = false;
      renderVrms();
    }
  }

  function vrmRowById(id: string): HTMLElement | null {
    return vrmsEl.querySelector<HTMLElement>(`.yui-vrm[data-vrm-id="${CSS.escape(id)}"]`);
  }

  async function swapTo(option: AvatarOption): Promise<void> {
    if (vrmSwapping !== null) return; // Prevent second swap while in progress
    if (option.id === vrmSelection.getActiveId()) return; // Already active, no-op

    // If previous error shown, clear it first (re-render removes inline guidance).
    if (vrmErrorId !== null) {
      vrmErrorId = null;
      renderVrms();
    }
    vrmSwapping = option.id;

    // Reflect loading: "swapping…" + spinner on clicked row, group locked with busy.
    // Mutate row in-place so caller's node reference persists (no re-render).
    vrmsEl.setAttribute("aria-busy", "true");
    vrmsEl.classList.add("is-swapping");
    const row = vrmRowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      const body = row.querySelector(".yui-vrm__body");
      if (body && !row.querySelector(".yui-vrm__hint")) {
        const hint = document.createElement("span");
        hint.className = "yui-vrm__hint";
        hint.textContent = t("vrm.swapping");
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await swapVrm(option);
      vrmRovedId = option.id; // Continue roving tabindex from committed row
      log.info("vrm_swap", { id: option.id });
      // Success: swapVrm committed store, subscription moves active row. Unlock, then re-render.
    } catch (err) {
      vrmErrorId = option.id;
      log.error("vrm_swap_failed", { id: option.id, error: String(err) });
      // Failure: selection stays (no revert, store unchanged). Error row + inline guidance.
    } finally {
      vrmSwapping = null;
      vrmsEl.removeAttribute("aria-busy");
      vrmsEl.classList.remove("is-swapping");
      renderVrms();
    }
  }

  // VRM radiogroup keyboard — same manual-activation as speaker section.
  // Enter/Space selects (swaps), arrows move roving focus only (wraps), Home/End jump ends.
  function handleVrmKeydown(e: KeyboardEvent): void {
    if (vrmSwapping !== null) return;
    // Inline rename input handles its own keys — guard so it doesn't leak to radio keyboard.
    if ((e.target as HTMLElement).closest(".yui-vrm--renaming")) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(".yui-vrm[role=radio]");
    if (!target) return;
    const rows = Array.from(vrmsEl.querySelectorAll<HTMLElement>(".yui-vrm[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = vrmSelection.list().find((o) => o.id === target.dataset.vrmId);
      if (opt) void swapTo(opt);
      return;
    }

    const current = Math.max(0, rows.indexOf(target));
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const wrapped = (next + rows.length) % rows.length;
    const focusTarget = rows[wrapped];
    vrmRovedId = focusTarget.dataset.vrmId ?? null;
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

  function handleAddClick(): void {
    void importVrmFlow();
  }

  return {
    render: renderVrms,
    handleKeydown: handleVrmKeydown,
    handleAddClick,
    isSwapping: () => vrmSwapping !== null,
  };
}
