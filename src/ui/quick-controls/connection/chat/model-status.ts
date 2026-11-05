/**
 * Maps the model-list read's phase plus the model text to the status line's view — pure, no DOM.
 */

import type { ModelListResult } from "../../../../io/chat/models/reader";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";

export interface StatusView {
  text: string;
  /** Dot classes to wear; empty leaves the dot grey. */
  dot: readonly string[];
  /** The action button's label; absent hides the button. */
  action?: string;
}

/** The failure kinds whose view the chat line and the server lines share. */
type SharedFailure = Extract<ServerCheck, { kind: "unreachable" | "timeout" | "refused" | "http" }>;

/** The one view for a read with no usable answer — Reconnect on the two states worth retrying. */
export function failureView(result: SharedFailure, host: string): StatusView {
  switch (result.kind) {
    case "unreachable":
      return {
        text: t("svc.chat_models_unreachable", { host }),
        dot: ["is-failed"],
        action: t("svc.chat_status_reconnect"),
      };
    case "timeout":
      return {
        text: t("svc.chat_models_timeout", { host }),
        dot: ["is-failed"],
        action: t("svc.chat_status_reconnect"),
      };
    case "refused":
      return { text: t("svc.chat_models_refused"), dot: ["is-failed"] };
    case "http":
      return { text: t("svc.chat_models_http", { status: result.status }), dot: ["is-failed"] };
  }
}

export type ModelStatusPhase = { phase: "reading" } | { phase: "done"; result: ModelListResult };

export function modelStatusView(input: {
  phase: ModelStatusPhase;
  /** The model field's committed value; empty falls back to defaultModel. */
  typedModel: string;
  defaultModel?: string;
  host: string;
}): StatusView {
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
      // No model name in the text — a constant string is announced once while typing.
      return { text: t("svc.chat_models_absent"), dot: [] };
    }
    case "unreachable":
    case "timeout":
    case "refused":
    case "http":
      return failureView(result, host);
    case "no_list":
      return { text: t("svc.chat_models_no_list"), dot: [] };
    case "malformed":
      return { text: t("svc.chat_models_malformed"), dot: ["is-failed"] };
  }
}
