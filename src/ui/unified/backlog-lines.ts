import { t } from "../i18n";
import type { BacklogLine } from "../message/backlog";
import type { Row } from "./merge";
import { EVERYONE } from "./targets";

/** "You → <recipient>": a preset id by its name, or EVERYONE. */
export function youTo(to: string, nameOf: (id: string) => string): string {
  return t("unified.you_to", { name: to === EVERYONE ? t("unified.everyone") : nameOf(to) });
}

/** The unified backlog's lines: the user's under "You → <recipient>", a character's under its name. */
export function backlogLines(rows: readonly Row[], nameOf: (id: string) => string): BacklogLine[] {
  return rows.map((row) => ({
    who: row.who === "user" ? youTo(row.to ?? "", nameOf) : row.name,
    text: row.text,
  }));
}
