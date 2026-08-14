/**
 * turn-error.test.ts — backend-call failure reason → inline input-error message.
 *
 * Maps the dispatcher's classified turn failure (user-initiated turns only) to the
 * short i18n string shown by showInputError. superseded_by_user is never a failure
 * (filtered upstream in the dispatcher) and is not part of this mapping's input type.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS } from "../dispatcher/backend-caller";
import { setLocale, t } from "./i18n";
import {
  isSettingsFixable,
  routeTurnFailure,
  turnErrorFixAction,
  turnErrorMessage,
} from "./turn-error";

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
    const seconds = IDLE_TIMEOUT_MS / 1000;
    expect(turnErrorMessage("network_stall")).toBe(t("input.error_stall", { seconds }));
    expect(turnErrorMessage("network_stall")).not.toBe(turnErrorMessage("network_drop"));
  });

  it("renders the watchdog deadline from IDLE_TIMEOUT_MS in every locale (no stale hardcoded figure)", () => {
    const seconds = String(IDLE_TIMEOUT_MS / 1000);
    for (const locale of ["en", "ko", "ja"] as const) {
      setLocale(locale);
      expect(turnErrorMessage("network_stall")).toContain(seconds);
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
      expect(message).not.toContain(t("tabs.adv"));
    }
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
});

describe("turnErrorFixAction", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  it("gives not_configured a labeled action that opens the Advanced tab", () => {
    const openSettings = vi.fn();

    const action = turnErrorFixAction("not_configured", openSettings);

    expect(action?.label).toBe(t("input.error_open_advanced"));
    action?.onClick();
    expect(openSettings).toHaveBeenCalledWith("adv");
  });

  it("names the Advanced tab on the label, in every locale", () => {
    for (const locale of ["en", "ko", "ja"] as const) {
      setLocale(locale);
      expect(turnErrorFixAction("not_configured", () => {})?.label).toContain(t("tabs.adv"));
    }
  });

  it("offers nothing for failures the settings panel cannot fix", () => {
    const reasons = [
      "http_4xx_drop",
      "network_drop",
      "network_stall",
      "parse_error",
      "superseded_by_user",
    ] as const;
    for (const reason of reasons) {
      expect(turnErrorFixAction(reason, () => {})).toBeUndefined();
    }
  });
});

describe("isSettingsFixable", () => {
  it("is true only for not_configured — the one failure the panel resolves", () => {
    expect(isSettingsFixable("not_configured")).toBe(true);
    for (const reason of [
      "http_4xx_drop",
      "network_drop",
      "network_stall",
      "parse_error",
      "superseded_by_user",
    ] as const) {
      expect(isSettingsFixable(reason)).toBe(false);
    }
  });

  it("is false for a detail string that is not a classified failure", () => {
    expect(isSettingsFixable("Voice input failed")).toBe(false);
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
