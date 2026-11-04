import { describe, expect, it } from "vitest";
import { checkServer } from "./server-check";

describe("checkServer", () => {
  it.each([
    ["no_list", async () => new Response("", { status: 404 }), { kind: "ok" }],
    [
      "unreachable",
      async () => {
        throw new TypeError("connection refused");
      },
      { kind: "unreachable" },
    ],
  ])("reads a %s model list as %o", async (_kind, impl, expected) => {
    await expect(
      checkServer({ baseUrl: "http://tts.test/v1", fetch: impl as typeof fetch }),
    ).resolves.toEqual(expected);
  });
});
