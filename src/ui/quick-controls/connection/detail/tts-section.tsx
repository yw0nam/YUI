/** The TTS section: the provider select, the URL and model fields, the key, its server line, and its reset. */

import type { ReactNode } from "react";

import type { Logger } from "../../../../logger";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";
import { Select } from "../../../controls/select";
import { t } from "../../../i18n";
import { TTS_PROVIDER_PRESETS } from "../../constants";
import { KeyRow, type KeyRowCommit } from "../../sections/key-row/key-row";
import type { EndpointForm } from "./endpoint-form";
import { EndpointRow } from "./endpoint-row";
import { ResetRow } from "./reset-row";
import { SelectRow } from "./select-row";

export function TtsSection({
  endpointsSettings,
  ttsKeySettings,
  form,
  defaults,
  keyCommit,
  serverLine,
  log,
}: {
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  ttsKeySettings: ApiKeySettingsStore;
  form: EndpointForm;
  defaults?: EndpointOverrides;
  keyCommit: KeyRowCommit;
  serverLine: ReactNode;
  log: Logger;
}) {
  // The override, else the bundled default.
  const provider =
    endpointsSettings.current().tts_provider ||
    defaults?.tts_provider ||
    TTS_PROVIDER_PRESETS[0].id;

  function pickProvider(id: string): void {
    const preset = TTS_PROVIDER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    // One store write, so the voice list and vocabulary reload once for the switch.
    endpointsSettings.set({
      tts_provider: preset.id,
      tts_base_url: preset.url,
      tts_model: preset.model,
    });
    form.drop(["tts_base_url", "tts_model"]);
    log.info("tts_provider_select", { provider: preset.id });
  }

  return (
    <section className="yui-sec yui-endpoints yui-svc" data-svc="tts">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("svc.tts")}</h2>
        <span className="yui-endpoints__hint">{t("svc.tts_hint")}</span>
      </div>
      <div className="yui-group">
        <SelectRow id="yui-svc-tts-provider" labelKey="svc.tts_type">
          <Select
            id="yui-svc-tts-provider"
            className="yui-tts-provider"
            aria-label={t("svc.tts_preset_aria")}
            value={provider}
            items={TTS_PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
            onValueChange={pickProvider}
          />
        </SelectRow>
        <EndpointRow field="tts_base_url" form={form} placeholder={defaults?.tts_base_url} />
        <EndpointRow field="tts_model" form={form} placeholder={defaults?.tts_model} />
        <KeyRow idPrefix="ttskey" store={ttsKeySettings} log={log} commit={keyCommit} />
        {serverLine}
        <ResetRow svc="tts" form={form} />
      </div>
    </section>
  );
}
