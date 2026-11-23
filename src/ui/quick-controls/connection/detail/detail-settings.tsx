/**
 * Detailed settings: the chat section, the reasoning-effort row, and the STT and TTS sections.
 * The page reaches it through `handle`: commit the drafts, enter it, close it.
 */

import { useLayoutEffect, useState } from "react";
import type { EndpointsConfig } from "../../../../contract";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import type { Logger } from "../../../../logger";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import type {
  ApiKeySettingsStore,
  ChatKeySettingsStore,
} from "../../../../settings/backend/api-key-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  effectiveChatApi,
} from "../../../../settings/backend/endpoints-settings";
import type { KeyRowCommit } from "../../sections/key-row/key-row";
import { type ChatPushPort, ChatSection, type ChatSectionHandle } from "../chat/chat-section";
import { StatusLine } from "../chat/chat-status";
import { hostOf } from "../server-line/host";
import { ServerLine, type ServerLineRun } from "../server-line/server-line";
import { EffortRow } from "./effort-row";
import { useEndpointForm } from "./endpoint-form";
import { SttSection } from "./stt-section";
import { TtsSection } from "./tts-section";
import "../endpoints-section.css";

export interface DetailSettingsDeps {
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  /** chat API key overrides store. Value is secret — no logging. */
  chatKeySettings: ChatKeySettingsStore;
  /** TTS (openai-compatible) API key overrides store. Value is secret — no logging. */
  ttsKeySettings: ApiKeySettingsStore;
  /** STT API key overrides store — the STT line re-checks when it commits. Value is secret — no logging. */
  sttKeySettings: ApiKeySettingsStore;
  agentSettings: Pick<
    ReturnType<typeof createAgentSettings>,
    "current" | "subscribe" | "setReasoningEffort"
  >;
  /** Asks the STT server whether it answers; absent keeps the STT line hidden. */
  checkSttServer?: () => Promise<ServerCheck | null>;
  /** Asks the TTS server whether it answers; absent keeps the TTS line hidden. */
  checkTtsServer?: () => Promise<ServerCheck | null>;
  /** The window's effective endpoints — the host and watch the lines show are the ones the checks read. */
  getEndpoints?: () => EndpointsConfig | null;
  /** Default bundled-config endpoints to show as placeholder (undefined if not loaded). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** Default bundled-config value for the chat protocol when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  /** Push transport state for the chat status line. Absent where nothing shows it. */
  pushSocket?: ChatPushPort;
  /** Entries read nothing and notifications check nothing while the panel is closed. */
  isOpen: () => boolean;
  /** Resolves the chat key the chat turn would send, per request (SecretProvider path). */
  getChatApiKey?: () => Promise<string | undefined>;
  /** Environment fetch for the model list read (selectFetch()), undefined → globalThis.fetch. */
  getFetch?: () => Promise<typeof globalThis.fetch | undefined>;
  log: Logger;
}

/** What the page calls on Detailed settings; set while it is mounted. */
export interface DetailSettingsHandle {
  current: {
    /** Lands the dirty keys, then the dirty endpoint fields. */
    commit(): void;
    /** Detailed settings came into view: the chat section evaluates its read, then the server lines run. */
    entered(): void;
    /** The panel closed: drop the in-flight model list read. */
    close(): void;
  } | null;
}

export function DetailSettings({
  handle,
  ...deps
}: DetailSettingsDeps & { handle: DetailSettingsHandle }) {
  const { endpointsSettings, getEndpoints, isOpen, log } = deps;
  const [refs] = useState(() => ({
    chat: { current: null } as ChatSectionHandle,
    chatKey: { current: null } as KeyRowCommit,
    ttsKey: { current: null } as KeyRowCommit,
    sttLine: { current: null } as ServerLineRun,
    ttsLine: { current: null } as ServerLineRun,
  }));
  const [onChatCommit] = useState(() => () => refs.chat.current?.evaluate());
  const form = useEndpointForm({
    endpointsSettings,
    keyStores: { chat: deps.chatKeySettings, tts: deps.ttsKeySettings },
    onChatCommit,
    log,
  });

  useLayoutEffect(() => {
    handle.current = {
      commit() {
        refs.chatKey.current?.();
        refs.ttsKey.current?.();
        form.commitDirty();
      },
      entered() {
        if (isOpen()) refs.chat.current?.evaluate();
        refs.sttLine.current?.();
        refs.ttsLine.current?.();
      },
      close: () => refs.chat.current?.close(),
    };
    return () => {
      handle.current = null;
    };
  }, [handle, refs, form, isOpen]);

  const defaults = deps.getEndpointDefaults?.();
  const push =
    effectiveChatApi(endpointsSettings.current().chat_api, deps.getDefaultChatApi?.()) === "push";
  // A service without its check or the window's endpoints keeps its line hidden.
  const sttLine =
    deps.checkSttServer && getEndpoints ? (
      <ServerLine
        check={deps.checkSttServer}
        host={() => hostOf(getEndpoints()?.stt_base_url ?? "")}
        watch={() => getEndpoints()?.stt_base_url ?? ""}
        subscribe={endpointsSettings.subscribe}
        subscribeKey={deps.sttKeySettings.subscribe}
        isOpen={isOpen}
        run={refs.sttLine}
      />
    ) : (
      <StatusLine view={null} onAction={() => {}} />
    );
  const ttsLine =
    deps.checkTtsServer && getEndpoints ? (
      <ServerLine
        check={deps.checkTtsServer}
        host={() => hostOf(getEndpoints()?.tts_base_url ?? "")}
        watch={() =>
          `${getEndpoints()?.tts_base_url ?? ""}\u0000${getEndpoints()?.tts_provider ?? ""}`
        }
        subscribe={endpointsSettings.subscribe}
        subscribeKey={deps.ttsKeySettings.subscribe}
        isOpen={isOpen}
        run={refs.ttsLine}
      />
    ) : (
      <StatusLine view={null} onAction={() => {}} />
    );

  return (
    <>
      <ChatSection
        endpointsSettings={endpointsSettings}
        chatKeySettings={deps.chatKeySettings}
        form={form}
        getEndpointDefaults={deps.getEndpointDefaults}
        getDefaultChatApi={deps.getDefaultChatApi}
        pushSocket={deps.pushSocket}
        getChatApiKey={deps.getChatApiKey}
        getFetch={deps.getFetch}
        keyCommit={refs.chatKey}
        onChatCommit={onChatCommit}
        handle={refs.chat}
        log={log}
      />
      <EffortRow agentSettings={deps.agentSettings} push={push} log={log} />
      <SttSection form={form} defaults={defaults} serverLine={sttLine} />
      <TtsSection
        endpointsSettings={endpointsSettings}
        ttsKeySettings={deps.ttsKeySettings}
        form={form}
        defaults={defaults}
        keyCommit={refs.ttsKey}
        serverLine={ttsLine}
        log={log}
      />
    </>
  );
}
