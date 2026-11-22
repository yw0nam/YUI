/** The inline name field of a list row: Enter and blur commit, Escape cancels. */

import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../i18n";

export function RenameInput({
  label,
  classPrefix,
  namespace,
  onCommit,
  onCancel,
  warnFor,
}: {
  label: string;
  /** The row's class prefix: `yui-vrm`. */
  classPrefix: string;
  /** The i18n namespace of the field's aria label and hint: `vrm`. */
  namespace: string;
  /** Returns whether the commit was taken; a refused one leaves the field open for a corrected name. */
  onCommit(label: string): boolean;
  onCancel(): void;
  /** The warning shown after the hint for the typed name. */
  warnFor?(name: string): string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(label);
  // The blur that follows a commit or a cancel must not commit again.
  const done = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  function finish(commit: boolean): void {
    if (done.current) return;
    done.current = true;
    if (commit) {
      if (!onCommit(input.current!.value)) done.current = false;
    } else onCancel();
  }
  const warn = warnFor?.(typed);
  return (
    <>
      <span className={`${classPrefix}__tick`} aria-hidden="true" />
      <span className="yui-input-wrap">
        <input
          ref={input}
          className="yui-ep-input"
          type="text"
          aria-label={t(`${namespace}.name_aria`)}
          defaultValue={label}
          onInput={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              // Escape cancels the field only; it does not reach the panel's close.
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      </span>
      <span className={`${classPrefix}__rename-hint`}>
        <kbd>Enter</kbd> {t(`${namespace}.rename_hint_save`)} · <kbd>Esc</kbd>{" "}
        {t(`${namespace}.rename_hint_cancel`)}
        {warn ? (
          <>
            {" · "}
            <span className={`${classPrefix}__overwrite-warn`}>{warn}</span>
          </>
        ) : null}
      </span>
    </>
  );
}
