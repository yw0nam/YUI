/**
 * chat_id store — the conversation id this installation identifies itself with.
 *
 * The push transport sends it in every `hello`, and the backend keeps conversation state under
 * it. Generated once on first read and reused for the life of the installation.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

interface ChatIdSettings {
  chat_id: string;
}

export type ChatIdStorage = PersistedStorage<string>;

const CHAT_ID_RE = /^yui-[0-9a-f]{8}$/;

function isChatId(v: unknown): v is string {
  return typeof v === "string" && CHAT_ID_RE.test(v);
}

/** `yui-` plus 8 lowercase hex characters drawn from the platform CSPRNG. */
function generateChatId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `yui-${hex}`;
}

export function createChatIdSettings(opts: { storage?: ChatIdStorage } = {}) {
  const core = createPersistedStore<ChatIdSettings>({
    storage: opts.storage
      ? {
          load: () => {
            const raw = opts.storage?.load();
            return isChatId(raw) ? { chat_id: raw } : null;
          },
          save: (s) => opts.storage?.save(s.chat_id),
        }
      : undefined,
    defaults: { chat_id: "" },
    parse: (v) => {
      const id = (v as ChatIdSettings | null)?.chat_id;
      return isChatId(id) ? { chat_id: id } : null;
    },
    equals: (a, b) => a.chat_id === b.chat_id,
  });

  if (!isChatId(core.current().chat_id)) core.commit({ chat_id: generateChatId() });

  return {
    get: core.get,
    dispose: core.dispose,
  };
}

export type ChatIdSettingsStore = ReturnType<typeof createChatIdSettings>;

/** localStorage adapter holding the raw id string under `yui.chat-id`. */
export function localStorageChatIdStorage(key = "yui.chat-id"): ChatIdStorage {
  return localStorageStore<string>(key);
}
