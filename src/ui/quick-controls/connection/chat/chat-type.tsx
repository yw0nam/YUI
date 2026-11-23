/**
 * Chat type row — a select whose popup carries the long option names and whose closed trigger
 * shows the short one, and a description line under the row.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { Select } from "../../../controls/select";
import { t } from "../../../i18n";
import { CHAT_APIS, type ChatApi } from "../../constants";
import { SelectRow } from "../detail/select-row";
import "./chat-type.css";

/** The type's short name: the closed trigger's text and the section's summary hint. */
export const chatTypeName = (api: ChatApi): string => t(`svc.chat_name_${api}`);

export function ChatTypeRow({ api, onPick }: { api: ChatApi; onPick(api: ChatApi): void }) {
  const desc = t(`svc.chat_desc_${api}`);
  const descRef = useRef<HTMLParagraphElement>(null);
  const shown = useRef(desc);

  // A changed description fades in; the first one does not.
  useLayoutEffect(() => {
    if (shown.current === desc) return;
    shown.current = desc;
    descRef.current?.classList.add("is-swapping");
  }, [desc]);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const settle = () => el.classList.remove("is-swapping");
    el.addEventListener("animationend", settle);
    return () => el.removeEventListener("animationend", settle);
  }, []);

  return (
    <SelectRow id="yui-svc-chat-type" labelKey="svc.type_label">
      <Select<ChatApi>
        id="yui-svc-chat-type"
        className="yui-chat-type"
        aria-label={t("svc.chat_aria")}
        value={api}
        items={CHAT_APIS.map((a) => ({ value: a, label: t(`svc.chat_option_${a}`) }))}
        valueLabel={chatTypeName}
        onValueChange={onPick}
      />
      <p className="yui-chat-type__desc" aria-live="polite" ref={descRef}>
        {desc}
      </p>
    </SelectRow>
  );
}
