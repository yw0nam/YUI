import { describe, expect, it } from "vitest";
import type { Row } from "./merge";
import {
  buildSend,
  EVERYONE,
  fallbackTarget,
  lastSpeakerOf,
  targetsFor,
  typedMention,
} from "./targets";

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

describe("buildSend with a typed @name", () => {
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
      "a typed leading name routes like a pick and the text stays as typed",
      null,
      "@Perlica hello",
      { sendId: "s1", targets: ["perlica"], text: "@Perlica hello", mention: "character" },
    ],
    [
      "a typed everyone sends to all",
      null,
      "@everyone hi",
      { sendId: "s1", targets: ["natsume", "perlica"], text: "@everyone hi", mention: "everyone" },
    ],
    [
      "a typed name that matches nothing falls back with no mention",
      null,
      "@nobody hello",
      { sendId: "s1", targets: ["natsume"], text: "@nobody hello" },
    ],
    [
      "a pick wins over a typed name",
      "perlica",
      "@Natsume hi",
      { sendId: "s1", targets: ["perlica"], text: "@Perlica @Natsume hi", mention: "character" },
    ],
  ])("%s", (_name, mention, text, expected) => {
    expect(buildSend({ ...base, mention, text })).toEqual(expected);
  });
});

describe("typedMention", () => {
  const cast = [
    { id: "perlica", name: "Perlica" },
    { id: "natsume", name: "Natsume" },
  ];
  const nested = [
    { id: "natsume", name: "Natsume" },
    { id: "shiki", name: "Natsume Shiki" },
  ];

  it.each([
    ["a full name before a space", "@Perlica hello", cast, "perlica"],
    ["a name alone at the end", "@perlica", cast, "perlica"],
    ["a name in any case", "@PERLICA hi", cast, "perlica"],
    ["everyone", "@everyone hi", cast, EVERYONE],
    ["here", "@here hi", cast, EVERYONE],
    ["all in any case", "@ALL hi", cast, EVERYONE],
    ["the longest of two open names", "@Natsume Shiki hi", nested, "shiki"],
    ["a name before an ideographic space", "@Perlica\u3000hi", cast, "perlica"],
    ["an @ inside the text", "hello @perlica", cast, null],
    ["an @ in an address", "mail me at a@b.c", cast, null],
    ["a name no preset carries", "@nobody hello", cast, null],
    ["a name that runs into more letters", "@PerlicaX", cast, null],
    [
      "a stored name that starts with a reserved word",
      "@All Stars hi",
      [{ id: "allstars", name: "All Stars" }],
      "allstars",
    ],
    ["an empty preset name", "@", [{ id: "blank", name: "" }], null],
  ])("%s", (_name, text, use, expected) => {
    expect(typedMention(text, use)).toBe(expected);
  });
});
