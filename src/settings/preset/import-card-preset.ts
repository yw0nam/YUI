/**
 * Creates a preset from an imported card: the name with a numeric suffix, the card merged
 * into the copied `yui.agent` with the send switch on, the PNG thumbnail retained onto the
 * entry, the one-shot greeting marker, and activation. The two thumbnail steps are ports
 * the app wiring supplies from io, so this module imports no io. Any failure removes the
 * created preset and discards the thumbnail before the original error rethrows.
 */

import type { Card } from "../../config/validators/persona/types";
import { createLogger } from "../../logger";
import { resolveStorageKey } from "./preset-keys";

const log = createLogger("preset-import");

export interface CreatePresetFromCardInput {
  registry: {
    create(name: string): string | null;
    setThumbnail(id: string, url: string | undefined): boolean;
    activate(id: string): boolean;
    remove(id: string): boolean;
  };
  card: Card;
  /** Renames the temp thumbnail copy to the preset id and returns its file URL. */
  retainThumbnail?: (presetId: string) => Promise<string>;
  /** Removes both thumbnail copies (temp id and preset id). Idempotent. */
  discardThumbnail?: (presetId: string) => Promise<void>;
  /** The key-value storage the copied `yui.agent` and the greeting marker live in. */
  storage?: Storage;
}

/** The agent value a new preset starts from when its copied one is missing or unparsable. */
const FALLBACK_AGENT = { reasoning_effort: "none" };

export async function createPresetFromCard(input: CreatePresetFromCardInput): Promise<string> {
  const { registry, card, retainThumbnail, discardThumbnail } = input;
  const kv = input.storage ?? globalThis.localStorage;
  const baseName = card.name.trim() || "Card";

  // create refuses a taken or empty name; the walk tries `base`, `base 2`, `base 3`, …
  let id = registry.create(baseName);
  for (let n = 2; id === null; n++) id = registry.create(`${baseName} ${n}`);

  try {
    const key = resolveStorageKey("yui.agent", id);
    let agent: Record<string, unknown> = { ...FALLBACK_AGENT };
    try {
      const raw = kv?.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          agent = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // An unparsable copied value starts the preset from the defaults
    }
    agent.send_card = true;
    agent.card = card;
    kv?.setItem(key, JSON.stringify(agent));

    if (retainThumbnail) {
      const url = await retainThumbnail(id);
      if (!registry.setThumbnail(id, url)) throw new Error("preset_create_failed");
    }

    kv?.setItem(resolveStorageKey("yui.greeting-pending", id), "1");
    if (!registry.activate(id)) throw new Error("preset_create_failed");
    return id;
  } catch (err) {
    if (!registry.remove(id)) log.warn("preset_rollback_refused", { preset: id });
    await discardThumbnail?.(id);
    throw err;
  }
}
