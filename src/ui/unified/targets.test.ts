import { describe, expect, it } from "vitest";
import type { Row } from "./merge";
import { buildSend, fallbackTarget, lastSpeakerOf, targetsFor } from "./targets";

const reverse = (ids: string[]) => [...ids].reverse();

describe("targetsFor", () => {
  const base = {
    cast: ["perlica", "natsume"],
    lastSpeaker: undefined,
    mainId: "perlica",
    shuffle: reverse,
  };

  it.each([
    ["everyone shuffles the cast", { mention: "everyone" }, ["natsume", "perlica"]],
    ["a pick goes to its preset", { mention: "natsume" }, ["natsume"]],
    ["no mention goes to the last speaker", { mention: null, lastSpeaker: "natsume" }, ["natsume"]],
    ["no mention and no speaker goes to main", { mention: null }, ["perlica"]],
    [
      "a last speaker who closed falls back to main",
      { mention: null, lastSpeaker: "gone" },
      ["perlica"],
    ],
  ])("%s", (_name, over, expected) => {
    expect(targetsFor({ ...base, ...over })).toEqual(expected);
  });
});

describe("lastSpeakerOf", () => {
  it("is the newest row that is not the user's", () => {
    const row = (who: string): Row => ({ key: who, who, name: who, text: "x", ts: 1 });

    expect(lastSpeakerOf([row("perlica"), row("natsume"), row("user")])).toBe("natsume");
    expect(lastSpeakerOf([row("user")])).toBeUndefined();
  });
});

describe("fallbackTarget", () => {
  const cast = ["perlica", "natsume"];

  it.each([
    ["the last speaker", "natsume", "perlica", "natsume"],
    ["main's preset when nobody spoke", undefined, "natsume", "natsume"],
    ["main's preset when the last speaker closed", "gone", "perlica", "perlica"],
    ["the first open preset when main closed too", "gone", "also-gone", "perlica"],
  ])("is %s", (_name, lastSpeaker, mainId, expected) => {
    expect(fallbackTarget({ cast, lastSpeaker, mainId })).toBe(expected);
  });

  it("is undefined while no preset is open", () => {
    expect(fallbackTarget({ cast: [], lastSpeaker: undefined, mainId: "perlica" })).toBeUndefined();
  });
});

describe("buildSend", () => {
  const cast = [
    { id: "perlica", name: "Perlica" },
    { id: "natsume", name: "Natsume" },
  ];
  const base = {
    text: "hi",
    cast,
    lastSpeaker: "natsume",
    mainId: "perlica",
    shuffle: reverse,
    sendId: "s1",
  };

  it.each([
    [
      "a picked preset",
      "perlica",
      { sendId: "s1", targets: ["perlica"], text: "@Perlica hi", mention: "character" },
    ],
    [
      "everyone",
      "everyone",
      { sendId: "s1", targets: ["natsume", "perlica"], text: "@everyone hi", mention: "everyone" },
    ],
    ["no mention", null, { sendId: "s1", targets: ["natsume"], text: "hi" }],
    ["a pick that closed", "gone", { sendId: "s1", targets: ["natsume"], text: "hi" }],
  ])("%s", (_name, mention, expected) => {
    expect(buildSend({ ...base, mention })).toEqual(expected);
  });

  it("is null while no preset is open", () => {
    expect(buildSend({ ...base, cast: [], mention: null })).toBeNull();
  });
});
