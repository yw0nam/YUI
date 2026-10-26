/**
 * card-filler.test.ts — the card's extensions.yui.filler wire key.
 *
 * Pins src/settings/voice/card-filler.ts: reading the card's filler, the card copy
 * without it, and the extensions copy that carries the store's pools on export.
 */

import { describe, expect, it } from "vitest";
import { readCard } from "../../config/validators/persona/read-card";
import type { Card } from "../../config/validators/persona/types";
import { cardWithoutFiller, extensionsWithFiller, readCardFiller } from "./card-filler";

const card = (extensions: Record<string, unknown>): Card =>
  readCard({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Mio", extensions } }).card;

const pools = { ja: { first: ["A"] } };

describe("card-filler", () => {
  it.each([
    {
      name: "read returns the card's yui.filler",
      run: () => readCardFiller(card({ yui: { filler: pools, keep: "x" }, other: {} })),
      want: pools as unknown,
    },
    {
      name: "read returns undefined while the card holds no yui object",
      run: () => readCardFiller(card({ other: {} })),
      want: undefined,
    },
    {
      name: "without strips filler and keeps the yui siblings and every other extension",
      run: () => cardWithoutFiller(card({ yui: { filler: pools, keep: "x" }, other: {} })).extensions,
      want: { yui: { keep: "x" }, other: {} },
    },
    {
      name: "without drops an emptied yui",
      run: () => cardWithoutFiller(card({ yui: { filler: pools }, other: {} })).extensions,
      want: { other: {} },
    },
    {
      name: "without leaves the input card untouched",
      run: () => {
        const c = card({ yui: { filler: pools } });
        cardWithoutFiller(c);
        return readCardFiller(c);
      },
      want: pools as unknown,
    },
    {
      name: "with merges filler into an existing yui and keeps every other extension",
      run: () => extensionsWithFiller({ yui: { keep: "x" }, other: {} }, pools),
      want: { yui: { keep: "x", filler: pools }, other: {} },
    },
    {
      name: "with adds yui while the extensions hold none",
      run: () => extensionsWithFiller({ other: {} }, pools),
      want: { other: {}, yui: { filler: pools } },
    },
    {
      name: "with omits filler while no list tier holds a phrase",
      run: () => extensionsWithFiller({ other: {} }, { ja: { first: [] } }),
      want: { other: {} },
    },
    {
      name: "with omits filler while every tool entry is empty",
      run: () => extensionsWithFiller({ other: {} }, { ja: { tool: { _default: [] } } }),
      want: { other: {} },
    },
    {
      name: "with keeps a tool entry that holds a phrase",
      run: () => extensionsWithFiller({ other: {} }, { ja: { tool: { _default: ["x"] } } }),
      want: { other: {}, yui: { filler: { ja: { tool: { _default: ["x"] } } } } },
    },
    {
      name: "with omits filler while the pools are empty",
      run: () => extensionsWithFiller({ other: {} }, {}),
      want: { other: {} },
    },
  ])("$name", ({ run, want }) => {
    expect(run()).toEqual(want);
  });
});
