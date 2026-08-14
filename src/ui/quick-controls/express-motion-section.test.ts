import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MotionRegistry } from "../../contract";
import { agentTriggerableMotionIds } from "../../io/broker-client";
import en from "../i18n/en";
import ja from "../i18n/ja";
import ko from "../i18n/ko";
import { EXPRESS_MOTION_GROUPS, groupExpressMotions } from "./express-motion-section";

const registry: MotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"),
);
const vocabulary = agentTriggerableMotionIds(registry);

describe("groupExpressMotions", () => {
  it("orders known ids by the static table, group by group", () => {
    expect(groupExpressMotions(["dance", "happy", "sulk", "sleeping"])).toEqual([
      { id: "reaction", ids: ["happy", "sulk"] },
      { id: "action", ids: ["sleeping", "dance"] },
    ]);
  });

  it("collects ids outside the table into the trailing 'other' group", () => {
    expect(groupExpressMotions(["wave", "happy", "shrug"])).toEqual([
      { id: "reaction", ids: ["happy"] },
      { id: "other", ids: ["wave", "shrug"] },
    ]);
  });

  it("omits a group no id in the vocabulary belongs to", () => {
    expect(groupExpressMotions(["dance"]).map((g) => g.id)).toEqual(["action"]);
  });

  it("returns nothing for an empty vocabulary", () => {
    expect(groupExpressMotions([])).toEqual([]);
  });

  it("places every id of the live catalog vocabulary in a table group — none fall through", () => {
    const grouped = groupExpressMotions(vocabulary);
    expect(grouped.map((g) => g.id)).not.toContain("other");
    expect(grouped.flatMap((g) => g.ids).sort()).toEqual([...vocabulary].sort());
  });
});

// Keys derive from configs/motions.json, and t() falls back to the raw key — a motion with no
// entry would render "express_motion.<id>.label" in the Character tab.
describe("express motion labels", () => {
  const dicts = [
    ["en", en],
    ["ja", ja],
    ["ko", ko],
  ] as const;

  it.each(dicts)("every agent-triggerable motion has a label and sub in %s", (_locale, dict) => {
    const missing = vocabulary.flatMap((id) =>
      [`express_motion.${id}.label`, `express_motion.${id}.sub`].filter((key) => !(key in dict)),
    );
    expect(missing).toEqual([]);
  });

  it.each(dicts)("every group, including the fallback, has a name in %s", (_locale, dict) => {
    const groups = [...EXPRESS_MOTION_GROUPS.map((g) => g.id), "other"];
    const missing = groups
      .map((id) => `express_motion.group.${id}`)
      .filter((key) => !(key in dict));
    expect(missing).toEqual([]);
  });
});
