/**
 * Maps the model-list read's phase plus the model text to the status line's view — pure, no DOM.
 */

import type { ModelListResult } from "../../../../io/chat/models/reader";
import { t } from "../../../i18n";

export interface ModelStatusView {
  text: string;
  /** Dot classes to wear; empty leaves the dot grey. */
  dot: readonly string[];
}

export type ModelStatusPhase = { phase: "reading" } | { phase: "done"; result: ModelListResult };

export function modelStatusView(input: {
  phase: ModelStatusPhase;
  /** The model field's committed value; empty falls back to defaultModel. */
  typedModel: string;
  defaultModel?: string;
  host: string;
}): ModelStatusView {
  const { phase, typedModel, defaultModel, host } = input;
  if (phase.phase === "reading") {
    return { text: t("svc.chat_models_reading"), dot: ["is-waiting", "is-busy"] };
  }
  const result = phase.result;
  switch (result.kind) {
    case "ok": {
      const model = typedModel !== "" ? typedModel : (defaultModel ?? "");
      if (model === "") {
        return { text: t("svc.chat_models_pick", { n: result.ids.length }), dot: ["is-waiting"] };
      }
      const present = result.ids.some((id) => id === model || id.startsWith(`${model}:`));
      if (present) {
        return { text: t("svc.chat_models_read", { n: result.ids.length }), dot: ["is-ready"] };
      }
      return { text: t("svc.chat_models_absent", { model }), dot: [] };
    }
    case "unreachable":
      return { text: t("svc.chat_models_unreachable", { host }), dot: ["is-failed"] };
    case "timeout":
      return { text: t("svc.chat_models_timeout", { host }), dot: ["is-failed"] };
    case "refused":
      return { text: t("svc.chat_models_refused"), dot: ["is-failed"] };
    case "http":
      return { text: t("svc.chat_models_http", { status: result.status }), dot: ["is-failed"] };
    case "no_list":
      return { text: t("svc.chat_models_no_list"), dot: [] };
    case "malformed":
      return { text: t("svc.chat_models_malformed"), dot: ["is-failed"] };
  }
}
