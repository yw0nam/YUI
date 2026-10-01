/**
 * The build-time API-key fallback — the `VITE_YUI_*_KEY` environment values, read only in dev
 * builds so no production bundle (desktop or APK) carries a key value. Release builds take their
 * keys from the Connection tab's stores alone.
 */

import { CHAT_API_KEY_SECRET, STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../config/load";

/** Secret name → build-time key. Empty in a production build. */
export function devKeyFallback(): Record<string, string | undefined> {
  // The DEV check is statically replaced at build time; the branch (and the key literals) drop out.
  if (!import.meta.env.DEV) return {};
  return {
    [CHAT_API_KEY_SECRET]: import.meta.env.VITE_YUI_CHAT_KEY,
    [STT_API_KEY_SECRET]: import.meta.env.VITE_YUI_STT_KEY,
    [TTS_API_KEY_SECRET]: import.meta.env.VITE_YUI_TTS_KEY,
  };
}
