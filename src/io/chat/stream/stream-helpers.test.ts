import { describe, expect, it } from "vitest";

import type { ControlEnvelope } from "../../../contract";
import {
  boundarySeparator,
  errorEventOf,
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

  it("errorEventOf carries the status only when the error has one", () => {
    expect(errorEventOf(Object.assign(new Error("502 bad gateway"), { status: 502 }))).toEqual({
      type: "error",
      message: "bad gateway",
      status: 502,
    });
    const statusless = errorEventOf(new Error("ECONNRESET"));
    expect(statusless).toEqual({ type: "error", message: "ECONNRESET" });
    expect("status" in statusless).toBe(false);
  });

  it("normalizeExpressIntoEnvelope writes only present fields", () => {
    const envelope: ControlEnvelope = { speech_text: "hi" };
    normalizeExpressIntoEnvelope(envelope, { motion_id: "wave", emotion_text: "warm" });
    expect(envelope).toEqual({ speech_text: "hi", motion: { id: "wave" }, emotion_text: "warm" });
  });
});

describe("boundarySeparator", () => {
  it("joins two responses' speech with one space", () => {
    expect(boundarySeparator("Let me check.", "It is 42.")).toBe(" ");
  });

  it("no separator when the earlier text ends in whitespace", () => {
    expect(boundarySeparator("Let me check. ", "It is 42.")).toBe("");
  });

  it("no separator when the later text starts with whitespace", () => {
    expect(boundarySeparator("Let me check.", "\nIt is 42.")).toBe("");
  });

  it("no separator after a CJK terminator", () => {
    expect(boundarySeparator("確認するね。", "42だよ。")).toBe("");
  });

  it("no separator when the turn has no earlier speech", () => {
    expect(boundarySeparator("", "Hello")).toBe("");
  });
});
