/** The reading dictionary of the Listening page: the textarea, its edits, and the line that names skipped lines. */

import { type FormEvent, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { parseReadings } from "../../../../io/voice/tts/readings";
import type { createReadingsSettings } from "../../../../settings/voice/readings-settings";
import { t } from "../../../i18n";
import "./readings-section.css";

type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;

// The same example in every language: the Korean bundle carries no Japanese script.
const PLACEHOLDER = "小明=シャオミン\n東雲=しののめ";

export function ReadingsSection({ store }: { store: ReadingsSettingsStore }) {
  const text = useSyncExternalStore(store.subscribe, () => store.current().text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const { skipped } = parseReadings(text);
  const invalid = skipped.length > 0;

  // A redraw under the cursor would drop the caret, so the focused textarea keeps what is typed.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement === textarea) return;
    textarea.value = text;
  }, [text]);

  // The search marks this row with is-match, so the invalid state rides its class list.
  useLayoutEffect(() => {
    entryRef.current?.classList.toggle("is-invalid", invalid);
  }, [invalid]);

  function handleInput(event: FormEvent<HTMLTextAreaElement>): void {
    store.setText(event.currentTarget.value);
  }

  return (
    <div className="yui-sec yui-reading">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("reading.section")}</h2>
      </div>
      <p className="yui-sec__note">{t("reading.note")}</p>
      <div className="yui-group">
        <div className="yui-stack yui-input-row yui-reading__entry" ref={entryRef}>
          <span className="yui-row__sub">{t("reading.sub")}</span>
          <textarea
            className="yui-textarea yui-textarea--short"
            spellCheck={false}
            rows={4}
            aria-label={t("reading.aria")}
            placeholder={PLACEHOLDER}
            ref={textareaRef}
            onInput={handleInput}
          />
          <p className="yui-input-row__error yui-reading__skipped" role="status">
            {skipped.length === 0
              ? ""
              : t(skipped.length === 1 ? "reading.skipped" : "reading.skipped_many", {
                  lines: skipped.join(", "),
                })}
          </p>
        </div>
      </div>
      <p className="yui-sec__foot">{t("reading.foot")}</p>
    </div>
  );
}
