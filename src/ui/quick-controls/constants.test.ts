/**
 * constants.test.ts — pins ENDPOINT_FIELDS as the derived projection of io/endpoints-settings's
 * ENDPOINT_FIELD_SPECS (url/string-kind rows only, in table order) so the panel keeps rendering
 * exactly the text-input rows the declarative table declares.
 */
import { describe, expect, it } from "vitest";
import { ENDPOINT_FIELD_SPECS } from "../../io/endpoints-settings";
import { ENDPOINT_FIELDS } from "./constants";

describe("ENDPOINT_FIELDS", () => {
  it("lists exactly the 5 url/string-kind fields, in table order", () => {
    expect(ENDPOINT_FIELDS.map((f) => f.key)).toEqual([
      "chat_base_url",
      "stt_base_url",
      "tts_base_url",
      "broker_base_url",
      "chat_model",
    ]);
  });

  it("excludes enum/posInt-kind fields (rendered elsewhere as dropdowns/devtools input)", () => {
    const excluded = ["chat_model_context_window", "chat_api"];
    for (const key of excluded) {
      expect(ENDPOINT_FIELDS.some((f) => f.key === key)).toBe(false);
    }
  });

  it("url flag matches the source spec's kind ('url' → true, 'string' → false)", () => {
    for (const f of ENDPOINT_FIELDS) {
      const spec = ENDPOINT_FIELD_SPECS.find((s) => s.key === f.key)!;
      expect(f.url).toBe(spec.kind === "url");
    }
  });

  it("carries a non-empty labelKey for every row", () => {
    for (const f of ENDPOINT_FIELDS) {
      expect(f.labelKey.length).toBeGreaterThan(0);
    }
  });
});
