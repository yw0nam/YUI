/**
 * A pasted key's row in Quick start: the masked field with its reveal toggle, the pill that
 * confirms it, the checking line, and the error with its key page link.
 */

import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { t } from "../../../i18n";
import { WARN_GLYPH } from "../../glyphs";
import { RevealToggle } from "../../sections/key-row/reveal-toggle";
import { KeyLink } from "./key-link";

/** Why a pasted key was not confirmed; `keyLink` shows the key page link beside it. */
export interface KeyError {
  textKey: string;
  keyLink: boolean;
}

/** The row's field, its error, and a focus request the field takes after the next render. */
export function usePasteKey() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<KeyError | null>(null);
  const [focusRequest, requestFocus] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  return {
    inputRef,
    error,
    requestFocus,
    clearError: () => setError(null),
    showError(textKey: string, keyLink = false): void {
      setError({ textKey, keyLink });
      requestFocus();
    },
    /** The pasted key, trimmed. */
    typedKey: (): string => inputRef.current?.value.trim() ?? "",
  };
}

export function PasteKeyRow({
  id,
  labelKey,
  actionKey,
  checkingKey,
  keyUrl,
  classes,
  inputRef,
  busy,
  error,
  hidden,
  onAction,
  children,
}: {
  id: string;
  labelKey: string;
  actionKey: string;
  checkingKey: string;
  keyUrl: string;
  /** The row's own hooks: the row, the pill, the checking line, the error and the key page link. */
  classes: { row: string; action: string; checking: string; error: string; reopen: string };
  inputRef: RefObject<HTMLInputElement | null>;
  /** The key is being checked: the field and the pill are locked. */
  busy: boolean;
  error: KeyError | null;
  hidden?: boolean;
  onAction(): void;
  /** Lines between the checking line and the error. */
  children?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className={`yui-row yui-chatkey ${classes.row}`} hidden={hidden}>
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={id}>
          {t(labelKey)}
        </label>
      </div>
      <div className="yui-input-wrap yui-chatkey__wrap">
        <input
          ref={inputRef}
          className="yui-ep-input yui-chatkey__input"
          id={id}
          type={revealed ? "text" : "password"}
          placeholder={t("start.paste_placeholder")}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={busy}
        />
        <RevealToggle
          idPrefix="chatkey"
          revealed={revealed}
          onToggle={() => setRevealed((shown) => !shown)}
        />
      </div>
      <button
        className={`yui-pill yui-pill--ok ${classes.action}`}
        type="button"
        disabled={busy}
        onClick={onAction}
      >
        {t(actionKey)}
      </button>
      <p className={classes.checking} role="status" hidden={!busy}>
        <i className="yui-start__dot" />
        {t(checkingKey)}
      </p>
      {children}
      <div className={classes.error} role="alert" hidden={!error}>
        {WARN_GLYPH}
        <div>
          <span className="yui-start__err-text">{error ? t(error.textKey) : ""}</span>{" "}
          <KeyLink
            url={keyUrl}
            labelKey="start.reopen"
            className={classes.reopen}
            hidden={!error?.keyLink}
          />
        </div>
      </div>
    </div>
  );
}
