import { describe, expect, it } from "vitest";
import { readCard } from "./read-card";

const V2_DATA = {
  name: "Mira",
  description: "A lighthouse keeper.",
  personality: "quiet",
  scenario: "A stormy night.",
  first_mes: "Come in.",
  mes_example: "<START>",
  creator_notes: "notes",
  system_prompt: "Stay in character.",
  post_history_instructions: "Be brief.",
  alternate_greetings: ["Hello.", "Evening."],
  tags: ["sea"],
  creator: "someone",
  character_version: "2",
  extensions: { depth_prompt: { depth: 4 } },
};

describe("readCard", () => {
  it("reads a V2 envelope's data as the card", () => {
    expect(readCard({ spec: "chara_card_v2", spec_version: "2.0", data: V2_DATA })).toEqual({
      card: V2_DATA,
      issues: [],
    });
  });

  it("keeps the V3-only fields under extensions.chara_card_v3", () => {
    const { card, issues } = readCard({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { ...V2_DATA, nickname: "Mi", group_only_greetings: [], source: ["x"], unknown: 1 },
    });
    expect(issues).toEqual([]);
    expect(card.name).toBe("Mira");
    expect(card.extensions).toEqual({
      depth_prompt: { depth: 4 },
      chara_card_v3: { nickname: "Mi", group_only_greetings: [], source: ["x"] },
    });
    expect(card).not.toHaveProperty("unknown");
  });

  it("reads a bare V1 object as data", () => {
    const { card, issues } = readCard({ name: "Old", description: "v1", first_mes: "Hi" });
    expect(issues).toEqual([]);
    expect(card).toMatchObject({ name: "Old", description: "v1", first_mes: "Hi", scenario: "" });
  });

  it("reports an unknown spec and returns the empty card", () => {
    const { card, issues } = readCard({ spec: "chara_card_v9", data: V2_DATA });
    expect(issues).toEqual(['unknown spec "chara_card_v9"']);
    expect(card.name).toBe("");
  });

  it("reports a value that is not an object", () => {
    expect(readCard("text").issues).toEqual(["card is not an object"]);
  });

  it("fills missing and mistyped fields with empties", () => {
    const { card, issues } = readCard({
      spec: "chara_card_v2",
      data: { name: 3, alternate_greetings: ["ok", 1], tags: "sea", extensions: [] },
    });
    expect(issues).toEqual([]);
    expect(card).toEqual({
      name: "",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "",
      extensions: {},
    });
  });

  it("caps an editable field at 4000 characters and keeps creator_notes whole", () => {
    const long = "a".repeat(4100);
    const { card } = readCard({
      spec: "chara_card_v2",
      data: { description: long, alternate_greetings: [long], creator_notes: long },
    });
    expect(card.description).toHaveLength(4000);
    expect(card.alternate_greetings[0]).toHaveLength(4000);
    expect(card.creator_notes).toHaveLength(4100);
  });
});
