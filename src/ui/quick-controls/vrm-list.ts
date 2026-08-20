/** VRM list cluster — VRM radiogroup in Character tab: render, rename, import, swap, keyboard. */
import type { AvatarOption } from "../../config/load";
import { sanitizeStem } from "../../io/safe-id";
import type { createVrmSelection } from "../../io/vrm-selection";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import { createUserAssetList, resolveRovedId } from "./user-asset-list";

const VRM_RENAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const VRM_REMOVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

interface VrmListDeps {
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
  dispose(): void;
}

export function createVrmList(deps: VrmListDeps): VrmList {
  const { vrmSelection, swapVrm, importVrm, removeUserVrm, log } = deps;
  const vrmsEl = deps.root.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmImportErrorEl = deps.root.querySelector<HTMLParagraphElement>(".yui-vrm__import-error")!;

  const list = createUserAssetList<AvatarOption>({
    containerEl: vrmsEl,
    importErrorEl: vrmImportErrorEl,
    classPrefix: "yui-vrm",
    datasetKey: "vrmId",
    i18nNamespace: "vrm",
    logPrefix: "vrm",
    log,
    list: () => vrmSelection.list(),
    getActiveId: () => vrmSelection.getActiveId(),
    getActive: () => vrmSelection.getActive(),
    getLabel: (opt) => opt.label,
    rename: (id, label) => vrmSelection.renameUserOption(id, label),
    removeFile: removeUserVrm,
    removeFromStore: (id) => vrmSelection.removeUserOption(id),
    swap: swapVrm,
    deriveId: sanitizeStem,
    importFn: importVrm,
    render: () => renderVrms(),
  });

  function renderVrms(): void {
    const activeId = vrmSelection.getActiveId();
    const options = vrmSelection.list();
    // Roving tabindex prioritizes last roved row — falls back to active if none.
    const ids = options.map((o) => o.id);
    const rovedId = resolveRovedId(list.getRovedId(), ids, activeId);
    list.prepareRender(ids);
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

      if (isUser && opt.id === list.getRenamingId()) {
        list.renderRenamingRow(row, opt);
      } else {
        const badgeHtml = selected ? `<span class="yui-vrm__badge">${t("vrm.in_use")}</span>` : "";
        const actionsHtml = isUser
          ? `<button class="yui-vrm__rename" type="button" title="${t("vrm.rename")}" aria-label="${t("vrm.rename")}">${VRM_RENAME_SVG}</button>` +
            `<button class="yui-vrm__remove" type="button" title="${t("vrm.remove")}" aria-label="${t("vrm.remove")}">${VRM_REMOVE_SVG}<span class="yui-vrm__remove-confirm">${t("vrm.remove_confirm")}</span></button>`
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
          void list.swapTo(opt);
        });
        if (isUser) {
          const removeBtn = row.querySelector<HTMLButtonElement>(".yui-vrm__remove")!;
          if (list.getArmedRemoveId() === opt.id) {
            row.classList.add("is-remove-armed");
            removeBtn.classList.add("is-armed");
            removeBtn.title = t("vrm.remove_confirm");
            removeBtn.setAttribute("aria-label", t("vrm.remove_confirm_aria", { name: opt.label }));
          }
          row
            .querySelector<HTMLButtonElement>(".yui-vrm__rename")!
            .addEventListener("click", (e) => {
              e.stopPropagation(); // Rename does not trigger row selection
              list.startRename(opt.id);
            });
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Remove does not trigger row selection
            void list.remove(opt.id);
          });
        }
      }

      vrmsEl.appendChild(row);

      // If previous error row, re-render as inactive and attach inline guidance below.
      if (opt.id === list.getErrorId()) {
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
    if (list.isImporting()) {
      const loading = document.createElement("div");
      loading.className = "yui-vrm__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-vrm__spin" aria-hidden="true"></span><span class="yui-vrm__loading-name">${t("vrm.loading")}</span>`;
      vrmsEl.appendChild(loading);
    }

    // If editing, focus input and exit (takes precedence over restoring roving focus).
    if (list.focusIfRenaming()) return;

    // If radiogroup had focus before re-render, restore focus to roving row.
    if (hadFocus) {
      const roved = list.rowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  return {
    render: renderVrms,
    handleKeydown: list.handleKeydown,
    handleAddClick: list.handleAddClick,
    isSwapping: list.isSwapping,
    dispose: list.dispose,
  };
}
