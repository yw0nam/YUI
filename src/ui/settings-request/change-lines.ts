import type { SettingsChange } from "../../settings/agent-access/document";

export function changeLine(_change: SettingsChange): string {
  return "";
}

export function whyLine(_why: string | undefined): string | null {
  return null;
}
