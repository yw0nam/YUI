// @vitest-environment jsdom
/**
 * card-io.test.ts — the card section's import of a dropped file.
 *
 * Pins `importDropped` of src/ui/quick-controls/sections/card/card-io.ts: the outcome the drop
 * cover shows for each port result, with the Card section's error line left untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../../../config/validators/persona/types";
import { createLogger } from "../../../../logger";
import { setLocale } from "../../../i18n";
import { type CardIoPorts, createCardIo } from "./card-io";
import { cardSectionHtml } from "./card-section";

function mount(importDroppedPreset: CardIoPorts["importDroppedPreset"]) {
  const host = document.createElement("div");
  host.innerHTML = cardSectionHtml();
  const root = host.querySelector<HTMLElement>(".yui-card")!;
  const io = createCardIo({
    root,
    ports: {
      importPreset: vi.fn(async () => null),
      importDroppedPreset,
      importBusy: { isBusy: () => false, subscribe: () => () => {} },
      exportPresetFile: vi.fn(async () => "cancelled" as const),
      exportCardPng: vi.fn(async () => "cancelled" as const),
    },
    openPresetPanel: () => {},
    currentCard: () => EMPTY_CARD,
    entry: () => ({ id: "abcd1234", name: "Mio" }),
    fillerPools: () => ({}),
    noticeStorage: { getItem: () => null, removeItem: () => {} },
    log: createLogger("card-io"),
  });
  return { io, errorEl: root.querySelector<HTMLElement>(".yui-card__io-error")! };
}

describe("createCardIo — importDropped", () => {
  beforeEach(() => setLocale("en"));

  it.each([
    ["a busy gate", async () => "busy" as const, "busy"],
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
  ] as const)("%s answers its outcome and writes no error line", async (_label, port, outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { io, errorEl } = mount(vi.fn(port));

    await expect(io.importDropped()).resolves.toBe(outcome);
    expect([errorEl.hidden, errorEl.textContent]).toEqual([true, ""]);
  });
});
