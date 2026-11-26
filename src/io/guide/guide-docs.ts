/** The guide docs bundled with the app, and the block that hands one to the backend. */

import capabilities from "../../../docs/guide/capabilities.md?raw";
import controls from "../../../docs/guide/controls.md?raw";
import type { GuideKey } from "../../contract";

const DOCS: Record<GuideKey, string> = { controls, capabilities };

/** A Markdown image line and the blank line after it: the site's pictures, which the backend cannot see. */
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\n\n?/gm;

const INSTRUCTION =
  "The user pressed the in-app help button. Answer from the guide below: start with the few most-used items, keep it short, and offer to go on; do not include links.";

export function isGuideKey(value: unknown): value is GuideKey {
  return typeof value === "string" && Object.hasOwn(DOCS, value);
}

/** A guide document as the user reads it, without the site's pictures. */
export function readGuide(key: GuideKey): string {
  return DOCS[key].replace(IMAGE_LINE, "").trim();
}

/** The `guide:` block of the client context: the instruction line, then the doc. */
export function renderGuideBlock(key: GuideKey): string {
  return `guide:\n${INSTRUCTION}\n\n${readGuide(key)}`;
}

const GUIDE_DECLARATION = `  guide: {
    /** A guide as the user reads it: "controls" (every gesture, key and button) or "capabilities" (what the character can do). */
    read(name: "controls" | "capabilities"): Promise<string>;
  };`;

/** The yui.guide namespace: one guide document as text. */
export function createGuideApi(): {
  methods: Record<string, (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>>;
  declaration: string;
} {
  return {
    methods: {
      read: async (_signal, name) => {
        if (!isGuideKey(name)) {
          throw new TypeError('yui.guide.read: name must be "controls" or "capabilities"');
        }
        return readGuide(name);
      },
    },
    declaration: GUIDE_DECLARATION,
  };
}
