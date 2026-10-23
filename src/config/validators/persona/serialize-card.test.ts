/**
 * serialize-card.test.ts — the V2 export envelope.
 *
 * Pins src/config/validators/persona/serialize-card.ts: a Card round-trips out as a chara_card_v2
 * envelope under the preset's effective name, with V3-only extras kept under
 * extensions.chara_card_v3 and the metadata fields unchanged.
 */

import { describe, expect, it } from "vitest";
import { readCard } from "./read-card";
import { toV2Envelope } from "./serialize-card";
import { type Card, EMPTY_CARD } from "./types";

const card: Card = {
  ...EMPTY_CARD,
  name: "Mio",
  description: "a card",
  creator_notes: "hi",
  tags: ["tag"],
  creator: "me",
  character_version: "1.0",
  alternate_greetings: ["Again!"],
};

describe("toV2Envelope", () => {
  it("writes the V2 envelope with the given name", () => {
    const envelope = toV2Envelope(card, "Preset Name");
    expect(envelope.spec).toBe("chara_card_v2");
    expect(envelope.spec_version).toBe("2.0");
    expect(envelope.data.name).toBe("Preset Name");
    expect(envelope.data.description).toBe("a card");
  });

  it("keeps a V3-imported card's extras under extensions.chara_card_v3", () => {
    const read = readCard({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { name: "Mio", nickname: "Mio-chan", group_only_greetings: [] },
    });
    const envelope = toV2Envelope(read.card, "Mio");
    expect(envelope.data.extensions).toEqual({
      chara_card_v3: { nickname: "Mio-chan", group_only_greetings: [] },
    });
  });

  it("carries the metadata fields unchanged", () => {
    const envelope = toV2Envelope(card, "Mio");
    expect(envelope.data.creator_notes).toBe("hi");
    expect(envelope.data.tags).toEqual(["tag"]);
    expect(envelope.data.creator).toBe("me");
    expect(envelope.data.character_version).toBe("1.0");
    expect(envelope.data.alternate_greetings).toEqual(["Again!"]);
  });
});
