/**
 * turn-error.test.ts — backend-call failure reason → inline input-error message.
 *
 * Maps the dispatcher's classified turn failure (user-initiated turns only) to the
 * short i18n string shown by showInputError. superseded_by_user is never a failure
 * (filtered upstream in the dispatcher) and is not part of this mapping's input type.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../i18n";
import { failureAction, fixAction, routeTurnFailure, turnErrorMessage } from "./turn-error";

describe("turnErrorMessage", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  it("maps http_4xx_drop to the auth message", () => {
    expect(turnErrorMessage("http_4xx_drop")).toBe(t("input.error_auth"));
  });

  it("maps network_drop to the network message", () => {
    expect(turnErrorMessage("network_drop")).toBe(t("input.error_network"));
  });

  it("maps network_stall to the stall message, distinct from the network one", () => {
    expect(turnErrorMessage("network_stall")).toBe(t("input.error_stall"));
    expect(turnErrorMessage("network_stall")).not.toBe(turnErrorMessage("network_drop"));
  });

  it("renders the same stall message in every locale (no stage-specific figure)", () => {
    for (const locale of ["en", "ko", "ja"] as const) {
      setLocale(locale);
      expect(turnErrorMessage("network_stall")).toBe(t("input.error_stall"));
    }
  });

  it("maps parse_error to the parse message", () => {
    expect(turnErrorMessage("parse_error")).toBe(t("input.error_parse"));
  });

  it("maps not_configured to a message stating the condition, in every locale", () => {
    // The destination is named by the fix action's label, so the message stays short
    // enough to sit in the input row next to it.
    expect(turnErrorMessage("not_configured")).toBe(t("input.error_not_configured"));
    for (const locale of ["en", "ko", "ja"] as const) {
      setLocale(locale);
      const message = turnErrorMessage("not_configured");
      expect(message).toBeTruthy();
      expect(message).not.toContain(t("hint.setup_action"));
    }
  });

  it.each([
    [
      "en",
      "Not connected yet",
      "The connection stopped responding",
      "Not connected yet. Open settings to connect",
    ],
    ["ko", "아직 연결 안 됨", "연결 응답 없음", "아직 연결 안 됨. 설정을 열어 연결하기"],
    [
      "ja",
      "まだ接続していません",
      "接続が応答しなくなりました",
      "まだ接続していません。設定を開いて接続する",
    ],
  ] as const)("says it in plain words in %s", (locale, notConfigured, stall, voiceFix) => {
    setLocale(locale);
    expect(turnErrorMessage("not_configured")).toBe(notConfigured);
    expect(turnErrorMessage("network_stall")).toBe(stall);
    expect(t("voice.error.not_configured_fix")).toBe(voiceFix);
  });

  it("follows the active locale (ko)", () => {
    setLocale("ko");
    expect(turnErrorMessage("network_drop")).toBe("응답 없음 · 연결 확인");
  });

  it("follows the active locale (ja)", () => {
    setLocale("ja");
    expect(turnErrorMessage("parse_error")).toBe("応答処理に失敗");
  });

  it("returns undefined for superseded_by_user (not a failure)", () => {
    expect(turnErrorMessage("superseded_by_user")).toBeUndefined();
  });

  it("renders a plain rate-limit line for a 429 detail, in every locale", () => {
    expect(turnErrorMessage("network_drop", { status: 429, message: "quota exceeded" })).toBe(
      "Usage limit reached · try again later",
    );
    setLocale("ko");
    expect(turnErrorMessage("network_drop", { status: 429, message: "quota exceeded" })).toBe(
      "사용 한도 도달 · 나중에 다시 시도",
    );
    setLocale("ja");
    expect(turnErrorMessage("network_drop", { status: 429, message: "quota exceeded" })).toBe(
      "利用上限に到達 · あとで再試行",
    );
  });
});

describe("turnErrorMessage — server error detail", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  it("renders status + server message when a 400 detail rides a network_drop", () => {
    expect(
      turnErrorMessage("network_drop", {
        status: 400,
        message: "model does not support tools",
      }),
    ).toBe("400 model does not support tools");
  });

  it("renders status + server message for a 500 detail", () => {
    expect(
      turnErrorMessage("network_drop", { status: 500, message: "internal server error" }),
    ).toBe("500 internal server error");
  });

  it("renders the message alone when the detail carries no status", () => {
    expect(turnErrorMessage("network_drop", { message: "rate limit reached" })).toBe(
      "rate limit reached",
    );
  });

  it("collapses and cuts a message with no status to one line of at most 200 chars", () => {
    const message = `${"x".repeat(100)}\n${"y".repeat(200)}`;
    const rendered = turnErrorMessage("network_drop", { message });
    expect(rendered).not.toContain("\n");
    expect(rendered!.length).toBe(200);
    expect(rendered!.endsWith("…")).toBe(true);
  });

  it("collapses newlines and cuts a 300-char message to one line of at most 200 chars ending with …", () => {
    const message = Array.from({ length: 300 }, (_, i) => (i % 25 === 24 ? "\n" : "x")).join("");
    const rendered = turnErrorMessage("network_drop", { status: 500, message });
    expect(rendered).toBeDefined();
    expect(rendered).not.toContain("\n");
    expect(rendered!.length).toBeLessThanOrEqual(200);
    expect(rendered!.endsWith("…")).toBe(true);
  });
});

describe("failureAction", () => {
  it.each([
    ["not_configured", undefined, "connect"],
    ["http_4xx_drop", undefined, "change_key"],
    ["network_drop", { status: 400, message: "bad request" }, "check_connection"],
    ["network_drop", { status: 404, message: "not found" }, "check_connection"],
    ["network_drop", { status: 499, message: "closed" }, "check_connection"],
    ["network_drop", { status: 500, message: "oops" }, "retry"],
    ["network_drop", { status: 503, message: "overloaded" }, "retry"],
    ["network_drop", { message: "rate limit reached" }, "retry"],
    ["network_drop", undefined, "retry"],
    ["network_stall", undefined, "retry"],
    ["network_drop", { status: 429, message: "quota" }, undefined],
    ["parse_error", undefined, undefined],
    ["superseded_by_user", undefined, undefined],
    ["Voice input failed", undefined, undefined],
  ] as const)("gives %s with %j the action %s", (reason, detail, expected) => {
    expect(failureAction(reason, detail)).toBe(expected);
  });
});

describe("fixAction", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  it.each([
    ["connect", "Connect"],
    ["change_key", "Change key"],
    ["check_connection", "Check connection"],
  ] as const)("gives %s a button labelled %s that opens Connection", (action, label) => {
    const openSettings = vi.fn();

    const button = fixAction(action, openSettings);

    expect(button?.label).toBe(label);
    button?.onClick();
    expect(openSettings).toHaveBeenCalledExactlyOnceWith("conn");
  });

  it("gives retry, no action and a host without a settings opener no button", () => {
    expect(fixAction("retry", () => {})).toBeUndefined();
    expect(fixAction(undefined, () => {})).toBeUndefined();
    expect(fixAction("change_key")).toBeUndefined();
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
