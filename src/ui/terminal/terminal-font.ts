/** The terminal font-size keys: Command (macOS) or Control with = or + grows, - shrinks, 0 resets. */

import { TERMINAL_FONT_PX } from "../../settings/threads/threads-window-settings";

/** The size `event` asks for from `current`; null when it is no font-size key. */
export function fontSizeFor(event: KeyboardEvent, current: number, mac: boolean): number | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  if (event.key === "0") return TERMINAL_FONT_PX.default;
  const step = { "=": 1, "+": 1, "-": -1 }[event.key];
  if (step === undefined) return null;
  return Math.min(TERMINAL_FONT_PX.max, Math.max(TERMINAL_FONT_PX.min, current + step));
}
