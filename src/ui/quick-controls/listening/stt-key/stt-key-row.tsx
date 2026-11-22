/**
 * The STT key row: the masked input, its reveal and clear buttons, and the sub line naming whether
 * an override is set. Typing commits nothing; blur, close or dispose does.
 */

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import { t } from "../../../i18n";
import { CHATKEY_CLEAR_SVG, CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG } from "../../constants";
import { toggleKeyReveal } from "../../sections/key-row/key-row";

const ID_PREFIX = "sttkey";

/** The row's commit-if-dirty, which the page facade calls on close and dispose. */
export interface SttKeyCommit {
  current: (() => void) | null;
}

export function SttKeyRow({
  store,
  log,
  commit,
}: {
  store: ApiKeySettingsStore;
  log: Logger;
  commit: SttKeyCommit;
}) {
  const apiKey = useSyncExternalStore(store.subscribe, () => store.current().apiKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dirty = useRef(false);
  const [revealed, setRevealed] = useState(false);

  const commitIfDirty = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const value = inputRef.current?.value ?? "";
    if (value) store.setApiKey(value);
    else store.clear();
  }, [store]);

  // A store change never overwrites the input while it is focused in a focused document.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (!document.hasFocus() || document.activeElement !== input) {
      input.value = apiKey;
      dirty.current = false;
    }
  }, [apiKey]);

  useLayoutEffect(() => {
    commit.current = commitIfDirty;
    return () => {
      commit.current = null;
    };
  }, [commit, commitIfDirty]);

  function handleInput(): void {
    dirty.current = true;
  }

  function handleBlur(): void {
    commitIfDirty();
    const input = inputRef.current;
    if (input) {
      input.value = store.current().apiKey;
      dirty.current = false;
    }
  }

  function handleToggle(): void {
    const input = inputRef.current;
    const button = toggleRef.current;
    if (!input || !button) return;
    toggleKeyReveal(input, button, ID_PREFIX);
    setRevealed(button.getAttribute("aria-pressed") === "true");
  }

  function handleClear(): void {
    dirty.current = false;
    if (inputRef.current) inputRef.current.value = "";
    store.clear();
    log.info(`${ID_PREFIX}_clear`);
  }

  const revealLabel = t(revealed ? `${ID_PREFIX}.hide` : `${ID_PREFIX}.show`);

  return (
    <div className="yui-row yui-input-row yui-chatkey" data-key-prefix={ID_PREFIX}>
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={`yui-${ID_PREFIX}-input`}>
          {t(`${ID_PREFIX}.label`)}
        </label>
        <span className="yui-input-row__sub">
          {t(apiKey ? `${ID_PREFIX}.sub_override` : `${ID_PREFIX}.sub_default`)}
        </span>
      </div>
      <div className="yui-input-wrap yui-chatkey__wrap">
        <input
          className="yui-ep-input yui-chatkey__input"
          id={`yui-${ID_PREFIX}-input`}
          ref={inputRef}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t(`${ID_PREFIX}.label`)}
          onInput={handleInput}
          onBlur={handleBlur}
        />
        <button
          className="yui-iconbtn yui-chatkey__toggle"
          ref={toggleRef}
          type="button"
          aria-pressed={revealed}
          aria-label={revealLabel}
          data-tip={revealLabel}
          onClick={handleToggle}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the key row
          dangerouslySetInnerHTML={{ __html: revealed ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG }}
        />
        <button
          className="yui-iconbtn yui-chatkey__clear"
          type="button"
          aria-label={t(`${ID_PREFIX}.clear`)}
          data-tip={t(`${ID_PREFIX}.clear`)}
          onClick={handleClear}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the key row
          dangerouslySetInnerHTML={{ __html: CHATKEY_CLEAR_SVG }}
        />
      </div>
    </div>
  );
}
