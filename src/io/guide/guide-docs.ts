/** The guide docs bundled with the app, and the block that hands one to the backend. */

import controls from "../../../docs/guide/controls.md?raw";
import capabilities from "../../../docs/guide/features.md?raw";
import type { GuideKey } from "../../contract";

const DOCS: Record<GuideKey, string> = { controls, capabilities };

const INSTRUCTION =
  "The user pressed the in-app help button. Answer from the guide below: start with the few most-used items, keep it short, and offer to go on; do not include links.";

export function isGuideKey(value: unknown): value is GuideKey {
  return typeof value === "string" && Object.hasOwn(DOCS, value);
}

/** The `guide:` block of the client context: the instruction line, then the doc. */
export function renderGuideBlock(key: GuideKey): string {
  return `guide:\n${INSTRUCTION}\n\n${DOCS[key].trim()}`;
}
