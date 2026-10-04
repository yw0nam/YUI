import { describe, expect, it } from "vitest";

import type { ControlEnvelope } from "../../contract";
import {
  httpStatusOf,
  isExpressTool,
  normalizeExpressIntoEnvelope,
  serverMessageOf,
} from "./stream-helpers";

describe("stream-helpers", () => {
  it("isExpressTool matches plain and MCP-namespaced names only", () => {
    expect(isExpressTool("generate_express")).toBe(true);
    expect(isExpressTool("mcp_yui_generate_express")).toBe(true);
    expect(isExpressTool("mcp_yui_get_ids")).toBe(false);
    expect(isExpressTool(undefined)).toBe(false);
  });

  it("serverMessageOf strips the leading status and httpStatusOf reads it", () => {
    const err = Object.assign(new Error("401 bad key"), { status: 401 });
    expect(httpStatusOf(err)).toBe(401);
    expect(serverMessageOf(err)).toBe("bad key");
    expect(httpStatusOf(new Error("x"))).toBeUndefined();
    expect(serverMessageOf(new Error("boom"))).toBe("boom");
  });

  it("normalizeExpressIntoEnvelope writes only present fields", () => {
    const envelope: ControlEnvelope = { speech_text: "hi" };
    normalizeExpressIntoEnvelope(envelope, { motion_id: "wave", emotion_text: "warm" });
    expect(envelope).toEqual({ speech_text: "hi", motion: { id: "wave" }, emotion_text: "warm" });
  });
});
