/** help-topic.test.ts — help() answers the API text, or a plugin's skill; any other topic throws. */

import { describe, expect, it } from "vitest";
import { createHelp } from "./help-topic";

const skill = async (name: string) => `skill body of ${name}`;

describe("createHelp", () => {
  it.each([undefined, null])("answers the API text for the topic %s", async (topic) => {
    await expect(createHelp(() => "api", { skill })(topic)).resolves.toBe("api");
  });

  it("answers a plugin's skill for plugin:<name>", async () => {
    await expect(createHelp(() => "api", { skill })("plugin:hello")).resolves.toBe(
      "skill body of hello",
    );
  });

  it.each([
    ["x", { skill }],
    [5, { skill }],
    ["plugin:hello", undefined],
  ])("throws for the topic %j", async (topic, plugins) => {
    await expect(createHelp(() => "api", plugins)(topic)).rejects.toThrow(
      new TypeError("help: topic must be plugin:<name>"),
    );
  });
});
