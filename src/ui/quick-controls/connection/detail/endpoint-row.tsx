/** One endpoint field row: its label and sub line, the field or the caller's control in its place, and the URL error. */

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { isValidEndpointUrl } from "../../../../settings/backend/endpoints-settings";
import { t } from "../../../i18n";
import { ENDPOINT_FIELDS } from "../../constants";
import type { EndpointForm, EndpointKey } from "./endpoint-form";

/** Enter commits the field, as a native change would; an IME's Enter confirms its text instead. */
export function isCommitEnter(e: { key: string; nativeEvent: KeyboardEvent }): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229;
}

export function EndpointRow({
  field,
  form,
  placeholder,
  subKey = "endpoints.field_sub",
  suggestions = [],
  labelId,
  reason,
  control,
}: {
  field: EndpointKey;
  form: EndpointForm;
  /** The bundled default; absent until the config loads. */
  placeholder?: string;
  /** Replaces the generic "leave empty" hint where empty means something specific. */
  subKey?: string;
  /** A datalist: the field offers those values and still takes free text. */
  suggestions?: readonly { value: string; labelKey: string }[];
  labelId?: string;
  /** A line under the sub line. */
  reason?: ReactNode;
  /** Renders in the field's place. */
  control?: ReactNode;
}) {
  const def = ENDPOINT_FIELDS.find((f) => f.key === field)!;
  const value = form.value(field);
  const invalid = def.url && !isValidEndpointUrl(value);
  const row = useRef<HTMLDivElement>(null);
  const listId = suggestions.length > 0 ? `yui-ep-list-${field}` : undefined;

  // Set outside React's className so settings search's `.is-match` on the row survives a render.
  useLayoutEffect(() => {
    row.current?.classList.toggle("is-invalid", invalid);
  }, [invalid]);

  return (
    <div className="yui-row yui-input-row" data-ep-field={field} ref={row}>
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={`yui-ep-${field}`} id={labelId}>
          {t(def.labelKey)}
        </label>
        <span className="yui-input-row__sub">{t(subKey)}</span>
        {reason}
      </div>
      <div className="yui-input-wrap">
        {control ?? (
          <input
            className={def.url ? "yui-ep-input yui-ep-input--url" : "yui-ep-input"}
            id={`yui-ep-${field}`}
            type="text"
            spellCheck={false}
            inputMode={def.url ? "url" : "text"}
            autoCapitalize="off"
            autoComplete="off"
            list={listId}
            placeholder={placeholder}
            value={value}
            aria-invalid={def.url ? invalid : undefined}
            onChange={(e) => form.type(field, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (isCommitEnter(e)) form.commitField(field, e.currentTarget.value);
            }}
            onBlur={() => form.commitDirty()}
          />
        )}
        {listId ? (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.labelKey)}
              </option>
            ))}
          </datalist>
        ) : null}
      </div>
      {def.url ? (
        <p className="yui-input-row__error" id={`yui-ep-err-${field}`} role="status">
          {t("endpoints.url_error")}
        </p>
      ) : null}
    </div>
  );
}
