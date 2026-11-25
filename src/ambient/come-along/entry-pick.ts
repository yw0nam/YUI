import type { StageConfig } from "../../config/validators/avatar/types";

export function pickEntry(
  _families: StageConfig["entry_families"],
  _emotion: string,
  _last: ReadonlyMap<string, string>,
  _random: () => number,
): { family: string; clip: string } {
  return { family: "", clip: "" };
}
