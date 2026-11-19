/**
 * card-active-hours.test.ts — the card's extensions.yui.active_hours key.
 *
 * Pins the spans-in-use resolution, the export transform, and Yui's shipped
 * default spans read from configs/persona.json through the real persona validator.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePersona } from "../../config/validators/persona/persona";
import { readCard } from "../../config/validators/persona/read-card";
import type { Card } from "../../config/validators/persona/types";
import { extensionsWithActiveHours, readCardActiveHours, spansInUse } from "./card-active-hours";
import type { Span } from "./spans";

const CARD_SPANS: Span[] = [{ start: "09:00", end: "12:00", pace: "low" }];
const EDITED_SPANS: Span[] = [{ start: "22:00", end: "02:00", pace: "high" }];

const cardWith = (yui: Record<string, unknown>): Card =>
  readCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "Mio", extensions: { yui } },
  }).card;

describe("spansInUse", () => {
  it.each([
    ["the edited spans", { active_hours: CARD_SPANS }, EDITED_SPANS, EDITED_SPANS],
    ["an edited empty list", { active_hours: CARD_SPANS }, [], []],
    ["null, from the card's spans", { active_hours: CARD_SPANS }, null, CARD_SPANS],
    ["null, past an invalid card key", { active_hours: "nope" }, null, []],
  ])("uses %s", (_name, yui, edited, expected) => {
    expect(spansInUse(edited, cardWith(yui))).toEqual(expected);
  });

  it("uses no spans with null and no card", () => {
    expect(spansInUse(null, undefined)).toEqual([]);
  });
});

describe("extensionsWithActiveHours", () => {
  it("null keeps the extensions as they are, the card's own key included", () => {
    const extensions = {
      yui: { active_hours: CARD_SPANS, filler: { en: { first: ["hi"] } } },
      other_ext: { kept: true },
    };
    expect(extensionsWithActiveHours(extensions, null)).toBe(extensions);
  });

  it("writes the edited list under yui.active_hours and keeps every other key", () => {
    const extensions = {
      yui: { filler: { en: { first: ["hi"] } } },
      other_ext: { kept: true },
    };
    expect(extensionsWithActiveHours(extensions, [])).toEqual({
      yui: { filler: { en: { first: ["hi"] } }, active_hours: [] },
      other_ext: { kept: true },
    });
  });
});

describe("readCardActiveHours on the shipped persona", () => {
  it.each([
    "en",
    "ja",
    "ko",
  ] as const)("reads Yui's three spans from the shipped %s card", (loc) => {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), "configs/persona.json"), "utf-8"),
    ) as unknown;
    expect(() => validatePersona("configs/persona.json", raw)).not.toThrow();
    const persona = validatePersona("configs/persona.json", raw);
    expect(readCardActiveHours(persona.cards[loc])).toEqual([
      { start: "08:00", end: "12:00", pace: "low" },
      { start: "12:00", end: "22:00", pace: "normal" },
      { start: "22:00", end: "03:00", pace: "high" },
    ]);
  });
});
