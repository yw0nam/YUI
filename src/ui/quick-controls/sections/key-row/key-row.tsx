/**
 * One secret API key row: the masked input, its reveal and clear buttons, and the sub line naming
 * whether an override is set. Typing commits nothing; blur, or the page's close or dispose through
 * `commit`, does. The value lives only in the input and the store.
 */

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import { Tip } from "../../../controls/tooltip";
import { t } from "../../../i18n";
import { CHATKEY_CLEAR_SVG } from "../../constants";
import { RevealToggle } from "./reveal-toggle";

/** The row's commit-if-dirty, which the page calls on close and dispose. */
export interface KeyRowCommit {
  current: (() => void) | null;
}

export function KeyRow({
  idPrefix,
  store,
  log,
  commit,
  onCommitted,
}: {
  /** Stamps the ids and the i18n keys: `chatkey`, `ttskey`, `sttkey`. */
  idPrefix: string;
  store: ApiKeySettingsStore;
  log: Logger;
  commit: KeyRowCommit;
  /** After a typed key lands in the store on blur. */
  onCommitted?: () => void;
}) {
  const apiKey = useSyncExternalStore(store.subscribe, () => store.current().apiKey);
  const inputRef = useRef<HTMLInputElement>(null);
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

  function handleBlur(): void {
    const wasDirty = dirty.current;
    commitIfDirty();
    const input = inputRef.current;
    if (input) input.value = store.current().apiKey;
    if (wasDirty) onCommitted?.();
  }

  function handleClear(): void {
    dirty.current = false;
    if (inputRef.current) inputRef.current.value = "";
    store.clear();
    log.info(`${idPrefix}_clear`);
  }

  return (
    <div className="yui-row yui-input-row yui-chatkey" data-key-prefix={idPrefix}>
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={`yui-${idPrefix}-input`}>
          {t(`${idPrefix}.label`)}
        </label>
        <span className="yui-input-row__sub">
          {t(apiKey ? `${idPrefix}.sub_override` : `${idPrefix}.sub_default`)}
        </span>
      </div>
      <div className="yui-input-wrap yui-chatkey__wrap">
        <input
          className="yui-ep-input yui-chatkey__input"
          id={`yui-${idPrefix}-input`}
          ref={inputRef}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t(`${idPrefix}.label`)}
          onInput={() => {
            dirty.current = true;
          }}
          onBlur={handleBlur}
        />
        <RevealToggle
          idPrefix={idPrefix}
          revealed={revealed}
          onToggle={() => setRevealed((shown) => !shown)}
        />
        <Tip text={t(`${idPrefix}.clear`)}>
          <button
            className="yui-iconbtn yui-chatkey__clear"
            type="button"
            aria-label={t(`${idPrefix}.clear`)}
            onClick={handleClear}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the other key fields
            dangerouslySetInnerHTML={{ __html: CHATKEY_CLEAR_SVG }}
          />
        </Tip>
      </div>
    </div>
  );
}
