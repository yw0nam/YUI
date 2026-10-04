import type { AvatarOption } from "../../load";
import { isObject } from "../shared";
import type { SectionContext } from "./helpers";

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file", "user"];
/** Allowed chars for AvatarOption.id — a persistence key and the CSS selector `[data-vrm-id="…"]` value, so no whitespace/special chars. */
const AVATAR_ID_RE = /^[A-Za-z0-9._-]+$/;

// available[] — optional VRM swap manifest.
export function validateAvailable(rawAvailable: unknown[], ctx: SectionContext): AvatarOption[] {
  const { issues } = ctx;
  const available: AvatarOption[] = [];
  rawAvailable.forEach((entry, i) => {
    if (!isObject(entry)) {
      issues.push(`available[${i}]: entry is not an object`);
      return;
    }
    for (const k of ["id", "label", "url"] as const) {
      if (typeof entry[k] !== "string" || (entry[k] as string).length === 0) {
        issues.push(
          `available[${i}].${k} must be a non-empty string (got: ${JSON.stringify(entry[k])})`,
        );
      }
    }
    // id is a persistence key + CSS selector value — no whitespace/quotes or other special chars ([A-Za-z0-9._-]).
    if (typeof entry.id === "string" && !AVATAR_ID_RE.test(entry.id)) {
      issues.push(
        `available[${i}].id must contain only [A-Za-z0-9._-] (got: ${JSON.stringify(entry.id)})`,
      );
    }
    const source = entry.source;
    if (
      source !== undefined &&
      !AVATAR_SOURCES.includes(source as AvatarOption["source"] & string)
    ) {
      issues.push(
        `available[${i}].source must be one of ${AVATAR_SOURCES.join("|")} (got: ${JSON.stringify(source)})`,
      );
    }
    available.push({
      id: entry.id as string,
      label: entry.label as string,
      url: entry.url as string,
      ...(source !== undefined ? { source: source as AvatarOption["source"] } : {}),
    });
  });
  // id uniqueness — find(x => x.id === …) resolves to the first entry only, so a duplicate is permanently unreachable.
  const seen = new Set<string>();
  available.forEach((opt, i) => {
    if (seen.has(opt.id)) {
      issues.push(`available[${i}].id is a duplicate (got: ${JSON.stringify(opt.id)})`);
    }
    seen.add(opt.id);
  });
  return available;
}
