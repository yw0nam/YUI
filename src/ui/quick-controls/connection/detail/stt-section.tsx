/** The STT section: the type the protocol names, the URL, model and language fields, its server line, and its reset. */

import type { ReactNode } from "react";

import type { EndpointOverrides } from "../../../../settings/backend/endpoints-settings";
import { Select } from "../../../controls/select";
import { t } from "../../../i18n";
import { STT_LANGUAGE_SUGGESTIONS } from "../../constants";
import type { EndpointForm } from "./endpoint-form";
import { EndpointRow } from "./endpoint-row";
import { ResetRow } from "./reset-row";
import { SelectRow } from "./select-row";

export function SttSection({
  form,
  defaults,
  serverLine,
}: {
  form: EndpointForm;
  defaults?: EndpointOverrides;
  serverLine: ReactNode;
}) {
  return (
    <section className="yui-sec yui-endpoints yui-svc" data-svc="stt">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("svc.stt")}</h2>
        <span className="yui-endpoints__hint">{t("svc.stt_hint")}</span>
      </div>
      <div className="yui-group">
        <SelectRow id="yui-svc-stt-type" labelKey="svc.type_label">
          {/* Disabled: the row only names the protocol. */}
          <Select
            id="yui-svc-stt-type"
            className="yui-select--single"
            aria-label={t("svc.type_label")}
            value="stt"
            items={[{ value: "stt", label: t("svc.stt_type") }]}
            onValueChange={() => {}}
            disabled
          />
        </SelectRow>
        <EndpointRow field="stt_base_url" form={form} placeholder={defaults?.stt_base_url} />
        <EndpointRow field="stt_model" form={form} placeholder={defaults?.stt_model} />
        <EndpointRow
          field="stt_language"
          form={form}
          placeholder={defaults?.stt_language}
          suggestions={STT_LANGUAGE_SUGGESTIONS}
          subKey="endpoints.stt_language.sub"
        />
        {serverLine}
        <ResetRow svc="stt" form={form} />
      </div>
    </section>
  );
}
