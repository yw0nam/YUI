/**
 * Tavern card import — the Rust `import_card_file` command (which opens the OS picker
 * itself) → the card for a new preset. Deps are injectable so tests never touch a real
 * Tauri runtime; the real Tauri API is lazily imported (non-Tauri/test envs never load it).
 */

import { readCard } from "../../../config/validators/persona/read-card";
import type { Card } from "../../../config/validators/persona/types";
import type { InvokeFn } from "../user-asset-import";

/** The VRM a preset file claimed: a user copy under app-data, or a bundled model named by id. */
export type ImportedCardVrm =
  | { kind: "user"; id: string; url: string; label: string }
  | { kind: "bundled"; id: string };

/** The voice clip a preset file staged under the import's staging folder. */
export interface ImportedCardVoice {
  stagedId: string;
  refUrl: string;
  label: string;
}

/** An imported card with every asset the native call claimed. */
export interface ImportedCard {
  card: Card;
  thumbnailTempId?: string;
  /** The picked file's kind: plain JSON, a PNG card, or a `.yui` preset file. */
  source: "json" | "png" | "yui";
  /** The preset file's crop as stored, unvalidated until the import orchestration reads it. */
  crop?: unknown;
  vrm?: ImportedCardVrm;
  voice?: ImportedCardVoice;
}

export interface CardImportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
  /** Rolls a temp thumbnail back after an unreadable payload. */
  removeThumbnail(id: string): Promise<void>;
  /** Rolls a claimed user VRM back. */
  removeUserVrm(id: string): Promise<void>;
  /** Rolls a claimed staged voice folder back. */
  removeUserVoice(id: string): Promise<void>;
  /** `@tauri-apps/api/core` convertFileSrc. */
  convertFileSrc(path: string): string;
}

/** The `import_card_file` result shape. */
interface ImportedCardFile {
  json: string;
  thumbnailTempId?: string | null;
  source: "json" | "png" | "yui";
  crop?: unknown;
  vrm?:
    | { kind: "user"; id: string; destPath: string; label: string }
    | { kind: "bundled"; id: string }
    | null;
  voice?: { id: string; refPath: string; label: string } | null;
}

async function defaultDeps(): Promise<CardImportDeps> {
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  return {
    invoke,
    convertFileSrc,
    removeThumbnail: (id) => invoke("remove_card_thumbnail", { id }).then(() => undefined),
    removeUserVrm: (id) => invoke("remove_user_vrm", { id }).then(() => undefined),
    removeUserVoice: (id) => invoke("remove_user_voice", { id }).then(() => undefined),
  };
}

/** The card-side form of one claimed VRM; the user copy's path becomes a webview URL. */
function mapVrm(
  vrm: ImportedCardFile["vrm"],
  convertFileSrc: CardImportDeps["convertFileSrc"],
): ImportedCardVrm | undefined {
  if (!vrm) return undefined;
  return vrm.kind === "user"
    ? { kind: "user", id: vrm.id, url: convertFileSrc(vrm.destPath), label: vrm.label }
    : { kind: "bundled", id: vrm.id };
}

/**
 * Run the card picker and read the chosen file. Returns null when the picker is
 * dismissed. A payload that does not parse into a card rolls every asset the native
 * call claimed back and throws `card_unreadable`.
 */
export async function importCardFromFile(
  reservedVrmIds: string[],
  voiceStagingId: string,
  deps?: CardImportDeps,
): Promise<ImportedCard | null> {
  const d = deps ?? (await defaultDeps());
  const file = await d.invoke<ImportedCardFile | null>("import_card_file", {
    reservedVrmIds,
    voiceStagingId,
  });
  if (!file) return null;

  const { json, thumbnailTempId, source, crop, vrm, voice } = file;
  let card: Card;
  try {
    const read = readCard(JSON.parse(json));
    if (read.issues.length > 0) throw new Error(read.issues.join("; "));
    card = read.card;
  } catch {
    await Promise.allSettled([
      ...(thumbnailTempId ? [d.removeThumbnail(thumbnailTempId)] : []),
      ...(vrm?.kind === "user" ? [d.removeUserVrm(vrm.id)] : []),
      ...(voice ? [d.removeUserVoice(voice.id)] : []),
    ]);
    throw new Error("card_unreadable");
  }
  return {
    card,
    source,
    ...(thumbnailTempId ? { thumbnailTempId } : {}),
    ...(crop !== undefined && crop !== null ? { crop } : {}),
    ...(vrm ? { vrm: mapVrm(vrm, d.convertFileSrc) } : {}),
    ...(voice
      ? {
          voice: {
            stagedId: voice.id,
            refUrl: d.convertFileSrc(voice.refPath),
            label: voice.label,
          },
        }
      : {}),
  };
}
