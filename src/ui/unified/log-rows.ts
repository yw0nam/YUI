/** DOM only: one line of the unified chat window's log and one chip of its cast. */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { ageText } from "../quick-controls/preset/relations/relation-glyph";
import { avatarEl, colorOf } from "./avatar";
import type { Row } from "./merge";

export function castChipEl(entry: PresetEntry): HTMLElement {
  const li = document.createElement("li");
  li.className = "yui-uc__chip";
  li.append(avatarEl(entry, 14), entry.name);
  return li;
}

export function lineEl(row: Row, cast: readonly PresetEntry[], now: number): HTMLElement {
  const entryOf = (id: string) => cast.find((c) => c.id === id);
  const li = document.createElement("li");
  li.className = "yui-uc__line";
  li.classList.toggle("is-pending", row.pending === true);
  const who = document.createElement("span");
  who.className = "yui-uc__who";
  const speaker = row.who === "user" ? undefined : entryOf(row.who);
  if (speaker) {
    who.append(avatarEl(speaker, 20));
    who.style.color = colorOf(speaker.id);
  }
  who.append(row.who === "user" ? t("history.who_user") : row.name);
  const say = document.createElement("p");
  say.className = "yui-uc__say";
  if (row.to) {
    const to = document.createElement("span");
    to.className = "yui-uc__to";
    to.style.color = colorOf(row.to);
    to.append(t("unified.marker", { name: entryOf(row.to)?.name ?? row.to }));
    say.append(to);
  }
  say.append(row.text);
  if (row.pending) {
    const sr = document.createElement("span");
    sr.className = "yui-uc__sr";
    sr.textContent = t("unified.pending");
    say.append(sr);
  }
  const ago = document.createElement("time");
  ago.className = "yui-uc__ago";
  const ms = now - row.ts;
  ago.textContent = row.open || ms < 60_000 ? t("unified.just_now") : ageText(ms);
  li.append(who, say, ago);
  return li;
}
