/**
 * turn-error.test.ts — backend-call failure reason → inline input-error message (issue #274).
 *
 * Maps the dispatcher's classified drop_reason (user-initiated turns only) to the
 * short i18n string shown by showInputError. superseded_by_user is never a failure
 * (filtered upstream in the dispatcher) and is not part of this mapping's input type.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "./i18n";
import { routeTurnFailure, turnErrorMessage } from "./turn-error";

describe("turnErrorMessage", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  it("maps http_4xx_drop to the auth message", () => {
    expect(turnErrorMessage("http_4xx_drop")).toBe(t("input.error_auth"));
  });

  it("maps network_drop to the network message", () => {
    expect(turnErrorMessage("network_drop")).toBe(t("input.error_network"));
  });

  it("maps parse_error to the parse message", () => {
    expect(turnErrorMessage("parse_error")).toBe(t("input.error_parse"));
  });

  it("follows the active locale (ko)", () => {
    setLocale("ko");
    expect(turnErrorMessage("network_drop")).toBe("응답 없음 · 연결 확인");
  });

  it("follows the active locale (ja)", () => {
    setLocale("ja");
    expect(turnErrorMessage("parse_error")).toBe("応答処理に失敗");
  });

  it("returns undefined for an unclassified reason (defensive — never hit for user turns)", () => {
    expect(turnErrorMessage("guardrail_drop")).toBeUndefined();
  });
});

describe("routeTurnFailure", () => {
  it("text turn + input open -> show the inline input error", () => {
    expect(routeTurnFailure("text", true)).toEqual({ kind: "show_input_error" });
  });

  it("text turn + input closed (dismissed mid-flight, e.g. Escape) -> nothing, log-only", () => {
    expect(routeTurnFailure("text", false)).toEqual({ kind: "none" });
  });

  it("voice turn -> the voice-indicator error state, regardless of input-open state", () => {
    expect(routeTurnFailure("voice", false)).toEqual({ kind: "voice_error" });
    expect(routeTurnFailure("voice", true)).toEqual({ kind: "voice_error" });
  });
});
