/**
 * Detailed settings' endpoint drafts: typing holds a draft per field and writes nothing; a commit
 * lands one field in the store, a blur or the page's close lands every draft. A field with no draft
 * shows the stored value.
 */

import { useReducer, useState, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import {
  type createEndpointsSettings,
  ENDPOINT_FIELD_SPECS,
  type EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
export type EndpointKey = keyof EndpointOverrides;
export type ServiceId = "chat" | "stt" | "tts";

export interface EndpointForm {
  /** The field's draft, else its stored value. */
  value(key: EndpointKey): string;
  /** A keystroke: the draft changes; the store does not. */
  type(key: EndpointKey, value: string): void;
  /** Writes one field and drops its draft; a chat URL commit re-evaluates the model list read. */
  commitField(key: EndpointKey, value: string): void;
  /** Writes every draft. */
  commitDirty(): void;
  /** Drops the drafts of fields another write just set. */
  drop(keys: readonly EndpointKey[]): void;
  /** Clears the service's fields and its own key; the shared STT key is cleared on the Listening page. */
  reset(svc: ServiceId): void;
}

export function useEndpointForm(deps: {
  endpointsSettings: EndpointsSettingsStore;
  /** The chat and TTS key stores a service reset clears. */
  keyStores: Partial<Record<ServiceId, ApiKeySettingsStore>>;
  /** A chat URL, key or protocol commit landed; stable for the page's life. */
  onChatCommit: () => void;
  log: Logger;
}): EndpointForm {
  const { endpointsSettings, keyStores, onChatCommit, log } = deps;
  useSyncExternalStore(endpointsSettings.subscribe, endpointsSettings.current);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [form] = useState<EndpointForm>(() => {
    const drafts = new Map<EndpointKey, string>();
    function commitField(key: EndpointKey, value: string): void {
      drafts.delete(key);
      endpointsSettings.set({ [key]: value });
      rerender();
      if (key === "chat_base_url") onChatCommit();
    }
    return {
      value: (key) => drafts.get(key) ?? endpointsSettings.current()[key],
      type(key, value) {
        drafts.set(key, value);
        rerender();
      },
      commitField,
      commitDirty() {
        for (const [key, value] of [...drafts]) commitField(key, value);
      },
      drop(keys) {
        for (const key of keys) drafts.delete(key);
        rerender();
      },
      reset(svc) {
        // Every field tagged with the service, the enum ones (chat_api, tts_provider) included.
        const fields = ENDPOINT_FIELD_SPECS.filter((s) => s.resetGroup === svc).map((s) => s.key);
        const patch: Partial<EndpointOverrides> = {};
        for (const key of fields) {
          patch[key] = "";
          drafts.delete(key);
        }
        endpointsSettings.set(patch);
        rerender();
        keyStores[svc]?.clear();
        log.info("svc_reset", { svc });
        if (svc === "chat") onChatCommit();
      },
    };
  });
  return form;
}
