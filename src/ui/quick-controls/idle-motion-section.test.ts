import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MotionRegistry } from "../../contract";
import en from "../i18n/en";
import ja from "../i18n/ja";
import ko from "../i18n/ko";
import { idleMotionKeyStem } from "./idle-motion-section";

const registry: MotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"),
);

describe("idleMotionKeyStem", () => {
  it("derives the i18n key from the variant file stem", () => {
    expect(idleMotionKeyStem("/motions/idle_01.vrma")).toBe("idle_motion.idle_01");
    expect(idleMotionKeyStem("/motions/calm.vrma")).toBe("idle_motion.calm");
  });
});

describe("idle variant labels", () => {
  const idle = registry.idle!;
  const variants = idle.variants?.length ? idle.variants : [idle.vrma_path];

  // Keys derive from configs/motions.json, and t() falls back to the raw key — a variant with no
  // entry would render "idle_motion.<stem>.label" in the Character tab.
  it.each([
    ["en", en],
    ["ja", ja],
    ["ko", ko],
  ])("every idle variant has a label and sub in %s", (_locale, dict) => {
    const missing = variants.flatMap((path) => {
      const stem = idleMotionKeyStem(path);
      return [`${stem}.label`, `${stem}.sub`].filter((key) => !(key in dict));
    });
    expect(missing).toEqual([]);
  });
});
