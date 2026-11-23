/**
 * Chat section of Detailed settings: the chat protocol and provider preset selects, the URL, the
 * model field with the server's ids, the key, and the status line that the push socket's state or
 * the model-list read fills.
 */

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { EndpointsConfig } from "../../../../contract";
import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import type { Logger } from "../../../../logger";
import type { ChatKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  effectiveChatApi,
  isValidEndpointUrl,
  mergeEndpoints,
} from "../../../../settings/backend/endpoints-settings";
import { Select } from "../../../controls/select";
import { t } from "../../../i18n";
import { CHAT_PRESET_CUSTOM, CHAT_PROVIDER_PRESETS } from "../../constants";
import { KeyRow, type KeyRowCommit } from "../../sections/key-row/key-row";
import { PushReason } from "../../sections/push-reason/push-reason";
import type { EndpointForm } from "../detail/endpoint-form";
import { EndpointRow } from "../detail/endpoint-row";
import { ResetRow } from "../detail/reset-row";
import { SelectRow } from "../detail/select-row";
import { hostOf } from "../server-line/host";
import { pushStatusView, StatusLine } from "./chat-status";
import { ChatTypeRow, chatTypeName } from "./chat-type";
import { ModelField } from "./model-field";
import { createModelRead, modelReadAction } from "./model-read";
import { type ModelStatusPhase, modelStatusView } from "./model-status";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;

/** The slice of the push port the status line needs — a state to show and a way to open now. */
export interface ChatPushPort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  reconnectNow(): void;
}

/** What Detailed settings calls on the chat section; set while it is mounted. */
export interface ChatSectionHandle {
  current: {
    /** After a trigger (entry, a URL, key or protocol commit, Reconnect): read, clear, or hand over to push. */
    evaluate(): void;
    /** The panel closed: drop the in-flight read. */
    close(): void;
  } | null;
}

const NO_SOCKET = () => () => {};
const MODEL_LABEL_ID = "yui-chat-model-list-label";

export function ChatSection({
  endpointsSettings,
  chatKeySettings,
  form,
  getEndpointDefaults,
  getDefaultChatApi,
  pushSocket,
  getChatApiKey,
  getFetch,
  keyCommit,
  onChatCommit,
  handle,
  log,
}: {
  endpointsSettings: EndpointsSettingsStore;
  chatKeySettings: ChatKeySettingsStore;
  form: EndpointForm;
  /** Default bundled-config endpoints — the effective URL/model when the override is empty. */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** Default bundled-config value for the chat protocol when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  pushSocket?: ChatPushPort;
  /** Resolves the chat key the chat turn would send, per request (SecretProvider path). */
  getChatApiKey?: () => Promise<string | undefined>;
  /** Environment fetch for the read (selectFetch()), undefined → globalThis.fetch. */
  getFetch?: () => Promise<typeof globalThis.fetch | undefined>;
  keyCommit: KeyRowCommit;
  /** A chat URL, key or protocol commit landed. */
  onChatCommit: () => void;
  handle: ChatSectionHandle;
  log: Logger;
}) {
  const [modelPhase, setModelPhase] = useState<ModelStatusPhase | null>(null);
  const [ids, setIds] = useState<readonly string[]>([]);
  const pushState = useSyncExternalStore(pushSocket?.onState ?? NO_SOCKET, () =>
    pushSocket?.getState(),
  );

  const [chat] = useState(() => {
    const chatApi = () =>
      effectiveChatApi(endpointsSettings.current().chat_api, getDefaultChatApi?.());
    // The same effective URL a chat turn reads — bundled defaults under the trimmed overrides.
    const effectiveUrl = (): string => {
      const base: EndpointsConfig = {
        chat_base_url: getEndpointDefaults?.()?.chat_base_url ?? "",
        stt_base_url: "",
        tts_base_url: "",
      };
      return mergeEndpoints(base, endpointsSettings.current()).chat_base_url;
    };
    const read = createModelRead({
      getApiKey: getChatApiKey ?? (async () => undefined),
      getFetch: getFetch ?? (async () => undefined),
      onPhase(phase) {
        setModelPhase(phase.phase === "cleared" ? null : phase);
        if (phase.phase === "done" && phase.result.kind === "ok") setIds(phase.result.ids);
        else if (phase.phase !== "reading") setIds([]);
      },
    });
    return {
      chatApi,
      effectiveUrl,
      read,
      evaluate(): void {
        const action = modelReadAction({
          push: chatApi() === "push",
          readable: getChatApiKey !== undefined && getFetch !== undefined,
          urlValid: isValidEndpointUrl(form.value("chat_base_url")),
          hasEffectiveUrl: effectiveUrl() !== "",
        });
        if (action === "push") {
          // Switching to push: the model list has no owner here — the line shows the socket state.
          read.abort();
          setIds([]);
          setModelPhase(null);
        } else if (action === "clear") read.clear();
        else read.start(effectiveUrl());
      },
      close: () => read.abort(),
    };
  });

  useLayoutEffect(() => {
    handle.current = chat;
    return () => {
      handle.current = null;
    };
  }, [handle, chat]);

  useEffect(() => () => chat.read.abort(), [chat]);

  const api = chat.chatApi();
  const push = api === "push";
  const url = endpointsSettings.current().chat_base_url.trim();
  // A preset that names a protocol is matched on it; the rest on the chat_base_url override.
  const preset =
    CHAT_PROVIDER_PRESETS.find((p) =>
      p.chatApi !== undefined ? p.chatApi === api : p.url === url && !push,
    )?.id ?? CHAT_PRESET_CUSTOM;
  const defaults = getEndpointDefaults?.();
  const view = push
    ? pushState === undefined
      ? null
      : pushStatusView(pushState)
    : modelPhase === null
      ? null
      : modelStatusView({
          phase: modelPhase,
          typedModel: form.value("chat_model"),
          defaultModel: defaults?.chat_model,
          host: hostOf(chat.effectiveUrl()),
        });

  function pickPreset(id: string): void {
    const picked = CHAT_PROVIDER_PRESETS.find((p) => p.id === id);
    // Custom autofills nothing — it is where the select lands when the URL matches no preset.
    if (!picked) return;
    if (picked.url !== undefined) form.commitField("chat_base_url", picked.url);
    if (picked.model !== undefined) form.commitField("chat_model", picked.model);
    if (picked.chatApi !== undefined) {
      endpointsSettings.set({ chat_api: picked.chatApi });
      onChatCommit();
    }
    log.info("chat_preset_select", { preset: picked.id });
  }

  return (
    <section className="yui-sec yui-endpoints yui-svc" data-svc="chat">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("svc.chat")}</h2>
        <span className="yui-endpoints__hint yui-chat-summary-hint">{chatTypeName(api)}</span>
      </div>
      <div className="yui-group">
        <ChatTypeRow
          api={api}
          onPick={(next) => {
            endpointsSettings.set({ chat_api: next });
            log.info("chat_api_change", { api: next });
            onChatCommit();
          }}
        />
        <SelectRow id="yui-svc-chat-preset" labelKey="svc.chat_preset_label">
          <Select
            id="yui-svc-chat-preset"
            className="yui-chat-preset"
            aria-label={t("svc.chat_preset_aria")}
            value={preset}
            items={[
              ...CHAT_PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.name })),
              { value: CHAT_PRESET_CUSTOM, label: t("svc.chat_preset_custom") },
            ]}
            onValueChange={pickPreset}
          />
        </SelectRow>
        <EndpointRow field="chat_base_url" form={form} placeholder={defaults?.chat_base_url} />
        <EndpointRow
          field="chat_model"
          form={form}
          labelId={MODEL_LABEL_ID}
          // Push carries no model of its own, so the field is disabled there with its reason.
          reason={<PushReason reasonKey="push.reason_model" hidden={!push} />}
          control={
            <ModelField
              value={form.value("chat_model")}
              ids={ids}
              disabled={push}
              placeholder={defaults?.chat_model}
              labelId={MODEL_LABEL_ID}
              onType={(next) => form.type("chat_model", next)}
              onCommit={(next) => form.commitField("chat_model", next)}
              onBlur={() => form.commitDirty()}
            />
          }
        />
        <KeyRow
          idPrefix="chatkey"
          store={chatKeySettings}
          log={log}
          commit={keyCommit}
          onCommitted={onChatCommit}
        />
        <StatusLine
          view={view}
          onAction={() => (push ? pushSocket?.reconnectNow() : chat.evaluate())}
        />
        <ResetRow svc="chat" form={form} />
      </div>
    </section>
  );
}
