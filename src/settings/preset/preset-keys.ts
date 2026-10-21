/** Which storage keys belong to a preset, and where a key lives under a given preset. */

/** The built-in preset; its keys are the unprefixed ones every release before presets wrote. */
export const DEFAULT_PRESET_ID = "default";

/** Settings a new preset copies from the one it is created from. */
export const PRESET_COPIED_KEYS: readonly string[] = [
  "yui.endpoints",
  "yui.chat-key",
  "yui.agent",
  "yui.tts",
  "yui.tts-key",
  "yui.speaker",
  "yui.vrm",
  "yui.camera",
  "yui.filler",
];

/** Every key a preset owns: its settings, its chat id, and its conversation. */
export const PRESET_KEYS: readonly string[] = [
  ...PRESET_COPIED_KEYS,
  "yui.message-window",
  "yui.chat-id",
  "yui.chat_transcript",
  "yui.previous_response_id",
  // Derived by the session store from its base key; it moves with that key.
  "yui.previous_response_id.tool_outputs",
  "yui.context-history",
  "yui.session_diagnostics",
  "yui.previous-turn",
];

/** The key `key` is stored under while `presetId` is active: `yui.<id>.<rest>` for a preset's own key. */
export function resolveStorageKey(key: string, presetId: string): string {
  if (presetId === DEFAULT_PRESET_ID || !PRESET_KEYS.includes(key)) return key;
  return `yui.${presetId}.${key.slice("yui.".length)}`;
}
