/** The inline rename field of a user VRM row: Enter and blur commit, Escape cancels. */

import { useLayoutEffect, useRef } from "react";
import { t } from "../../../i18n";

export function RenameInput({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit(label: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The blur that follows a commit or a cancel must not commit again.
  const done = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  function finish(commit: boolean): void {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(input.current!.value);
    else onCancel();
  }
  return (
    <>
      <span className="yui-vrm__tick" aria-hidden="true" />
      <span className="yui-input-wrap">
        <input
          ref={input}
          className="yui-ep-input"
          type="text"
          aria-label={t("vrm.name_aria")}
          defaultValue={label}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              // Escape cancels the rename only; it does not reach the panel's close.
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      </span>
      <span className="yui-vrm__rename-hint">
        <kbd>Enter</kbd> {t("vrm.rename_hint_save")} · <kbd>Esc</kbd> {t("vrm.rename_hint_cancel")}
      </span>
    </>
  );
}
