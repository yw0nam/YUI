import type { PresetEntry } from "../preset/active-preset";

/** The name the client-context lines and the tools show for a preset: a preset named `user` is disambiguated. */
export function targetLabel(name: string): string {
  return name.toLowerCase() === "user" ? `${name} (character)` : name;
}

/** Label to preset id for the given presets. */
export function targetLabels(entries: PresetEntry[]): Map<string, string> {
  return new Map(entries.map(({ id, name }): [string, string] => [targetLabel(name), id]));
}
