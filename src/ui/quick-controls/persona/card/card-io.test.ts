// @vitest-environment jsdom
/**
 * card-io.test.ts — the card section's file actions.
 *
 * Pins `importDropped` and the export envelope of src/ui/quick-controls/persona/card/card-io.ts:
 * the outcome the drop cover shows for each port result, and the card text each save dialog gets.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Card, EMPTY_CARD } from "../../../../config/validators/persona/types";
import { createLogger } from "../../../../logger";
import type { Span } from "../../../../settings/active-hours/spans";
import { setLocale } from "../../../i18n";
import { type CardIoPorts, createCardIo } from "./card-io";

function mount(importDroppedPreset: CardIoPorts["importDroppedPreset"]) {
  return createCardIo({
    ports: {
      importPreset: vi.fn(async () => null),
      importDroppedPreset,
      importBusy: { isBusy: () => false, subscribe: () => () => {} },
      exportPresetFile: vi.fn(async () => "cancelled" as const),
      exportCardPng: vi.fn(async () => "cancelled" as const),
    },
    currentCard: () => EMPTY_CARD,
    entry: () => ({ id: "abcd1234", name: "Mio" }),
    fillerPools: () => ({}),
    activeHoursSpans: () => null,
    log: createLogger("card-io"),
  });
}

describe("createCardIo — importDropped", () => {
  beforeEach(() => setLocale("en"));

  it.each<[string, CardIoPorts["importDroppedPreset"], string]>([
    ["a busy gate", async () => "busy", "busy"],
    ["a created preset", async () => ({ presetId: "abcd1234" }), "imported"],
    [
      "an unreadable card",
      async () => {
        throw new Error("card_unreadable");
      },
      "unreadable",
    ],
    [
      "a refused drop",
      async () => {
        throw "unsupported file";
      },
      "failed",
    ],
  ])("%s answers its outcome and writes no error line", async (_label, port, outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const io = mount(vi.fn(port));

    await expect(io.importDropped()).resolves.toBe(outcome);
  });
});

describe("createCardIo — export", () => {
  beforeEach(() => setLocale("en"));

  const CARD_SPANS: Span[] = [
    { start: "08:00", end: "12:00", pace: "low" },
    { start: "12:00", end: "22:00", pace: "normal" },
  ];

  async function exportExtensions(
    activeHoursSpans: () => Span[] | null,
    card: Card,
  ): Promise<Record<string, unknown>> {
    let cardJson: string | undefined;
    const io = createCardIo({
      ports: {
        importPreset: vi.fn(async () => null),
        importDroppedPreset: vi.fn(async () => "busy" as const),
        importBusy: { isBusy: () => false, subscribe: () => () => {} },
        exportPresetFile: vi.fn(async (req: { cardJson: string }) => {
          cardJson = req.cardJson;
          return { vrmIncluded: true, bytes: 1 };
        }),
        exportCardPng: vi.fn(async () => "cancelled" as const),
      },
      currentCard: () => card,
      entry: () => ({ id: "abcd1234", name: "Yui" }),
      fillerPools: () => ({}),
      activeHoursSpans,
      log: createLogger("card-io"),
    });
    await io.exportPreset({});
    return JSON.parse(cardJson!).data.extensions as Record<string, unknown>;
  }

  it("writes the edited spans into extensions.yui.active_hours", async () => {
    const edited: Span[] = [{ start: "09:00", end: "10:00", pace: "normal" }];
    const extensions = await exportExtensions(() => edited, {
      ...EMPTY_CARD,
      extensions: { yui: { active_hours: CARD_SPANS } },
    });
    expect((extensions.yui as Record<string, unknown>).active_hours).toEqual(edited);
  });

  it("with no edited spans, the card's own key passes through unchanged", async () => {
    const extensions = await exportExtensions(() => null, {
      ...EMPTY_CARD,
      extensions: { yui: { active_hours: CARD_SPANS, other: 1 } },
    });
    expect(extensions).toEqual({ yui: { active_hours: CARD_SPANS, other: 1 } });
  });
});
