/**
 * One secret API key row (`keyRowHtml`): the masked input, its reveal and clear buttons, and the
 * sub line naming whether an override is set. Typing commits nothing; blur, close or dispose does.
 * The value lives only in the input and the store.
 */

import type { Logger } from "../../../../logger";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import { t } from "../../../i18n";
import { CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG } from "../../constants";

export interface KeyRow {
  reflect(): void;
  commitIfDirty(): void;
  /** Commit what was typed, then remove the listeners and the store subscription. */
  dispose(): void;
}

export function createKeyRow(deps: {
  root: HTMLElement;
  idPrefix: string;
  store: ApiKeySettingsStore;
  /** The store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
  log: Logger;
  /** After a typed key lands in the store. */
  onCommit?: () => void;
}): KeyRow {
  const { root, idPrefix, store, isOpen, log, onCommit } = deps;
  const row = root.querySelector<HTMLDivElement>(`.yui-input-row[data-key-prefix="${idPrefix}"]`)!;
  const input = row.querySelector<HTMLInputElement>(".yui-chatkey__input")!;
  const subEl = row.querySelector<HTMLSpanElement>(".yui-input-row__sub")!;
  const toggleBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
  const clearBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__clear")!;
  let dirty = false;

  function reflect(): void {
    const key = store.get().apiKey;
    if ((!document.hasFocus() || document.activeElement !== input) && input.value !== key) {
      input.value = key;
      dirty = false;
    }
    subEl.textContent = key ? t(`${idPrefix}.sub_override`) : t(`${idPrefix}.sub_default`);
  }
  function commitIfDirty(): void {
    if (!dirty) return;
    dirty = false;
    const v = input.value;
    if (v) store.setApiKey(v);
    else store.clear();
  }
  function handleInput(): void {
    dirty = true;
  }
  function handleBlur(): void {
    const wasDirty = dirty;
    commitIfDirty();
    reflect();
    if (wasDirty) onCommit?.();
  }
  function handleToggle(): void {
    const show = toggleBtn.getAttribute("aria-pressed") !== "true";
    toggleBtn.setAttribute("aria-pressed", String(show));
    input.type = show ? "text" : "password";
    toggleBtn.innerHTML = show ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG;
    const label = show ? t(`${idPrefix}.hide`) : t(`${idPrefix}.show`);
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.dataset.tip = label;
  }
  function handleClear(): void {
    dirty = false;
    input.value = "";
    store.clear();
    log.info(`${idPrefix}_clear`);
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("blur", handleBlur);
  toggleBtn.addEventListener("click", handleToggle);
  clearBtn.addEventListener("click", handleClear);
  const unsubscribe = store.subscribe(() => {
    if (isOpen()) reflect();
  });

  return {
    reflect,
    commitIfDirty,
    dispose(): void {
      commitIfDirty();
      unsubscribe();
      input.removeEventListener("input", handleInput);
      input.removeEventListener("blur", handleBlur);
      toggleBtn.removeEventListener("click", handleToggle);
      clearBtn.removeEventListener("click", handleClear);
    },
  };
}
