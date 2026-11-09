/**
 * Preset file (`.yui`) export steps — the Rust `inspect_preset_vrm` / `export_preset_file` /
 * `export_card_png` commands, which open the OS dialogs themselves. Deps are injectable so
 * tests never touch a real Tauri runtime; the real Tauri API is lazily imported.
 */

import { type InvokeFn, loadInvoke } from "../user-asset-import";

export type PresetExportResult = "written" | "cancelled";

/** The VRM an export request names: a user file under app-data, or a bundled model. */
export type PresetVrmRef = { kind: "user" | "bundled"; id: string };

/** The `.yui` export request; camelCase over the Rust `PresetFileExportRequest`. */
export interface PresetExportRequest {
  defaultName: string;
  cardJson: string;
  thumbnailPresetId?: string;
  crop?: unknown;
  vrm?: PresetVrmRef;
  voice?: { id: string; label: string };
}

/** The license verdict and size of the user VRM an export would carry. */
export interface VrmInspection {
  license: "allowed" | "prohibited" | "unknown";
  bytes: number;
}

/** A written preset file, without the always-true `saved` flag. */
export interface PresetFileWritten {
  vrmIncluded: boolean;
  bytes: number;
}

export type PresetFileExportResult = PresetFileWritten | "cancelled";

export interface PresetFileExportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
}

/** Reads the license and size of a user VRM before the export offers it. */
export async function inspectPresetVrm(
  id: string,
  deps?: PresetFileExportDeps,
): Promise<VrmInspection> {
  const d = deps ?? { invoke: await loadInvoke() };
  return d.invoke<VrmInspection>("inspect_preset_vrm", { id });
}

/** Writes the `.yui` preset file through the OS save dialog the command opens; dismissed → "cancelled". */
export async function exportPresetFile(
  request: PresetExportRequest,
  deps?: PresetFileExportDeps,
): Promise<PresetFileExportResult> {
  const d = deps ?? { invoke: await loadInvoke() };
  const out = await d.invoke<{ saved: boolean; vrmIncluded: boolean; bytes: number }>(
    "export_preset_file",
    { request },
  );
  return out.saved ? { vrmIncluded: out.vrmIncluded, bytes: out.bytes } : "cancelled";
}

/** Writes the card text into the preset's PNG through the OS save dialog; dismissed → "cancelled". */
export async function exportCardPng(
  defaultName: string,
  cardJson: string,
  presetId: string,
  deps?: PresetFileExportDeps,
): Promise<PresetExportResult> {
  const d = deps ?? { invoke: await loadInvoke() };
  const written = await d.invoke<boolean>("export_card_png", { defaultName, cardJson, presetId });
  return written ? "written" : "cancelled";
}
