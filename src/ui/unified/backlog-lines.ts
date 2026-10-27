import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import type { BacklogLine } from "../message/backlog";
import type { SpeechOp } from "../surfaces/apply-speech-op";
import type { Row } from "./merge";
import { EVERYONE, typedMention, typedMentionLength } from "./targets";

/** "You → <recipient>": a preset id by its name, or EVERYONE. */
export function youTo(to: string, nameOf: (id: string) => string): string {
  return t("unified.you_to", { name: to === EVERYONE ? t("unified.everyone") : nameOf(to) });
}

/** The text without its leading typed @name tokens that name `to` (a preset id or EVERYONE), which
 * "You → <recipient>" already says. */
export function withoutLeadMention(text: string, to: string, cast: readonly PresetEntry[]): string {
  const lead = cast.filter((e) => e.id === to);
  let rest = text;
  while (typedMention(rest, lead) === to) rest = rest.slice(typedMentionLength(rest, lead)!);
  return rest;
}

type QuoteOp = Extract<SpeechOp, { op: "quote" }>;

/** A quote a preset's window sent, as the unified box shows it under its lead. */
export function shownQuote(op: QuoteOp, preset: string, cast: readonly PresetEntry[]): QuoteOp {
  const to = op.quote.mention === EVERYONE ? EVERYONE : preset;
  return { ...op, quote: { ...op.quote, text: withoutLeadMention(op.quote.text, to, cast) } };
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
          text: withoutLeadMention(row.text, row.to ?? "", cast),
        }
      : { who: row.name, text: row.text },
  );
}
