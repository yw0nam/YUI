import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import type { BacklogLine } from "../message/backlog";
import type { Row } from "./merge";
import { EVERYONE, typedMentionLength } from "./targets";

/** "You → <recipient>": a preset id by its name, or EVERYONE. */
export function youTo(to: string, nameOf: (id: string) => string): string {
  return t("unified.you_to", { name: to === EVERYONE ? t("unified.everyone") : nameOf(to) });
}

/** A routed message's text as the window shows it: without the leading @name its lead repeats. */
export function withoutMention(text: string, cast: readonly PresetEntry[]): string {
  return text.slice(typedMentionLength(text, cast) ?? 0);
}

/** The unified backlog's lines: the user's under "You → <recipient>", a character's under its name. */
export function backlogLines(
  rows: readonly Row[],
  nameOf: (id: string) => string,
  cast: readonly PresetEntry[],
): BacklogLine[] {
  return rows.map((row) =>
    row.who === "user"
      ? {
          who: youTo(row.to ?? "", nameOf),
          text: row.to === undefined ? row.text : withoutMention(row.text, cast),
        }
      : { who: row.name, text: row.text },
  );
}
